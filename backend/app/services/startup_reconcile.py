"""
Fail the steps a previous process left "processing", and give back what they
were charged.

A step is charged BEFORE its provider is called (pipeline.execute_step), so
every way a step can end badly needs a compensating refund. Two are in the
running process: the provider error caught by execute_step, and a timeout in
task_manager. This is the third: the process itself goes away (a deploy, a
crash, an out-of-memory kill) while a step is running. A crash or a SIGKILL
lets nothing in that process run, and the step is left "processing" and
charged. Until this refunded it, every deploy during a hero's paint or sculpt
took the user's credits and kept them.

A deploy is the common case, and it now shuts down cleanly: uvicorn gets
Railway's SIGTERM (backend/Dockerfile `exec`s it), and the lifespan shutdown
cancels this process's tasks and calls `interrupt_running`, which refunds and
fails the steps they were in at once, through the same function as the sweep.
The sweep stays for everything that does not shut down cleanly.

WHEN, not just what. The old version ran once, the moment a new process
started. But a deploy OVERLAPS: the old process keeps running until the new one
is healthy, and keeps running its steps. Measured on staging (hero 493a5a20,
2026-10-15): the new process marked a painting "failed (server restart)" at
00:01:23, the old one finished that painting at 00:01:39, charged the sculpt and
started it, and was then killed. The painting was not lost at all, and the
sculpt, started after the only reconciliation had run, sat "processing" (the
user's "Try again" refused as busy) until the next deploy 26 minutes later -
which marked it failed and kept its 5 credits. Refunding at that first instant
would have refunded a delivered painting and still missed the sculpt.

So it runs as a sweep: first after SWEEP_FIRST_DELAY (the old process is gone
by then), then every SWEEP_EVERY. It fails a "processing" step only when no task
in THIS process is running its hero, which is what makes a step an orphan once
this is the only process. It covers a step run on its own and a whole-pipeline
run (PIPELINE_KEY) alike: a pipeline task has no row of its own, and the step it
was inside is the one left "processing". The steps after it are "pending" and
were never charged. Assumes one backend replica, as the old reconciliation did.

The refund is `credits.refund_last_step_charge`, the same one the other two
paths use, keyed on the spend row (`refund:tx:<id>`): two processes sweeping at
once, or a process dying mid-sweep, refund each charge once. A class hero's
charge is on its class wallet (the wallet owns the creation and paid for the
step), and the refund goes back to whoever the spend row debited: the wallet.
"""
import asyncio
import logging
import os
from datetime import timedelta
from typing import Callable, Collection, Dict, Optional

from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import CreationStep
from app.services import step_errors
from app.services.credits import refund_last_step_charge

logger = logging.getLogger(__name__)

RESTART_MESSAGE = "Step was processing when server restarted. Please retry."
RESTART_NOTE = "restart"
SHUTDOWN_NOTE = "shutdown"

# How long the shutdown waits for cancelled tasks to unwind before refunding
# their steps. Cancelling lands at the task's next await, so this is normally
# milliseconds; it is a bound, not a pause. Inside Railway's draining window
# with uvicorn's --timeout-graceful-shutdown (backend/Dockerfile,
# backend/railway.toml).
SHUTDOWN_TASK_WAIT = float(os.getenv("SHUTDOWN_TASK_WAIT_SECONDS", "5"))

# Railway kills the old process once the new one passes /health (migrations
# can hold that up to ~60 s; railway.toml). Five minutes is well clear of it.
SWEEP_FIRST_DELAY = float(os.getenv("STUCK_STEP_SWEEP_DELAY_SECONDS", "300"))
SWEEP_EVERY = float(os.getenv("STUCK_STEP_SWEEP_EVERY_SECONDS", "300"))

# How far a step's charge may come BEFORE its started_at and still be this
# attempt's. The endpoints mark a step processing (started_at) and then charge,
# so for them the charge is later. A step the pipeline reaches on its own is
# charged first and stamped a moment after, in the same process, milliseconds
# apart. An earlier attempt's charge (a hero that completed, a cancel that
# keeps its charge) is at least that attempt's provider call older.
CHARGE_SLACK = timedelta(seconds=30)


def reconcile_stuck_steps(
    db: Session,
    is_running: Optional[Callable[[str], bool]] = None,
    creation_ids: Optional[Collection[str]] = None,
    note: str = RESTART_NOTE,
) -> Dict[str, int]:
    """Fail every orphaned "processing" step and refund its charge.

    `is_running(creation_id)` says a task in this process is working on that
    hero; its steps are left alone. `creation_ids`, if given, limits this to
    those heroes (the shutdown's own; during a deploy the other process is
    running its steps too). `note` is recorded on the refund. Returns counts.

    Refunds first, then marks: the refund commits on its own, so if the
    process dies between the two the step is still "processing", the next
    sweep finds it again, and the refund (keyed on the spend row) is not paid
    twice. A step that cannot be refunded is logged and still marked failed,
    so it does not spin forever.
    """
    query = db.query(CreationStep).filter(CreationStep.status == "processing")
    if creation_ids is not None:
        if not creation_ids:
            return {"stuck": 0, "refunded": 0, "credits_refunded": 0}
        query = query.filter(CreationStep.creation_id.in_(list(creation_ids)))
    stuck = query.all()
    if is_running is not None:
        stuck = [s for s in stuck if not is_running(s.creation_id)]
    counts = {"stuck": len(stuck), "refunded": 0, "credits_refunded": 0}
    if not stuck:
        return counts

    logger.warning("Found %s steps left processing (%s)", len(stuck), note)
    # Read everything needed before any commit: refund_last_step_charge commits
    # (and on a race rolls back), which expires these rows.
    work = [(s.id, s.creation_id, s.step_name, s.started_at) for s in stuck]
    for step_id, creation_id, step_name, started_at in work:
        refund = refund_last_step_charge(
            db, creation_id, step_name,
            note=note,
            charged_since=(started_at - CHARGE_SLACK) if started_at else None,
        )
        # A refund that was already there (a second sweeper, a sweep cut off
        # before it marked the step) comes back too: made whole either way.
        if refund is not None:
            counts["refunded"] += 1
            counts["credits_refunded"] += refund.delta

        step = db.query(CreationStep).filter(CreationStep.id == step_id).first()
        if step is None or step.status != "processing":
            continue
        step_errors.mark_failed(step, RESTART_MESSAGE, code=step_errors.INTERRUPTED)
        step_errors.note_refund(step, refund)
        db.commit()
        logger.info(
            "Marked step %s:%s as failed (%s)%s",
            creation_id, step_name, note, " and refunded it" if refund is not None else "",
        )

    logger.info(
        "Reconciled %s stuck steps; refunded %s of them (%s credits)",
        counts["stuck"], counts["refunded"], counts["credits_refunded"],
    )
    return counts


def sweep_once(task_manager) -> Dict[str, int]:
    """One sweep with its own session, skipping heroes `task_manager` runs."""
    db = SessionLocal()
    try:
        return reconcile_stuck_steps(
            db, is_running=lambda cid: bool(task_manager.running_for_creation(cid)),
        )
    except Exception:
        logger.exception("Stuck-step sweep failed; trying again next time")
        db.rollback()
        return {}
    finally:
        db.close()


async def sweep_forever(task_manager, first_delay: float = None, every: float = None) -> None:
    """The lifespan's background task.

    Runs ON the event loop, not in a thread: an endpoint commits a step as
    "processing" and registers its task with no await in between, so a sweep
    can never see the one without the other.
    """
    first_delay = SWEEP_FIRST_DELAY if first_delay is None else first_delay
    every = SWEEP_EVERY if every is None else every
    await asyncio.sleep(first_delay)
    while True:
        sweep_once(task_manager)
        await asyncio.sleep(every)


async def interrupt_running(task_manager, wait: float = None) -> Dict[str, int]:
    """The lifespan's shutdown: cancel this process's tasks and make whole the
    steps they were in, now, instead of minutes into the next process.

    A cancelled step raises CancelledError, a BaseException, which passes by
    execute_step's `except Exception` refund (as on a timeout): left alone it
    stays "processing" and charged until a sweep. So once the tasks have
    unwound, their heroes' "processing" steps go through reconcile_stuck_steps:
    the sweep's own refund (`refund_last_step_charge`, keyed on the spend row)
    and error code (`interrupted`). Two consequences:

    - Only this process's heroes. During a deploy the new process is already
      running its own steps; failing every "processing" step would cut those
      off.
    - Idempotent with the sweep. A step refunded here is "failed" by the time
      the next process sweeps; one refunded but not yet marked (the process
      killed in between) is found again, and its refund is not paid twice.

    A task still running after `wait` (it did not take the cancel) is left to
    the next process's sweep.
    """
    wait = SHUTDOWN_TASK_WAIT if wait is None else wait
    ours = task_manager.running_creations()
    cancelled = task_manager.cancel_all_tasks()
    tasks = task_manager.get_all_tasks()
    if tasks:
        await asyncio.wait(tasks, timeout=wait)
    db = SessionLocal()
    try:
        counts = reconcile_stuck_steps(
            db,
            is_running=lambda cid: bool(task_manager.running_for_creation(cid)),
            creation_ids=ours,
            note=SHUTDOWN_NOTE,
        )
    except Exception:
        logger.exception("Shutdown could not refund interrupted steps; the sweep will")
        db.rollback()
        counts = {}
    finally:
        db.close()
    return {"cancelled": cancelled, **counts}
