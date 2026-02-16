"""
Task Manager - Tracks running async tasks for step execution with auto-cleanup and timeouts.
"""
import asyncio
import threading
import logging
from typing import Dict, Optional
from collections.abc import Coroutine

from app.database import SessionLocal
from app.models import CreationStep

logger = logging.getLogger(__name__)

# Global TaskManager instance (set in main.py lifespan)
_task_manager: Optional['TaskManager'] = None


class TaskManager:
    """Task tracking for step execution with auto-cleanup and timeouts."""
    
    def __init__(self, default_timeout: int = 3600):
        """
        Initialize TaskManager.
        
        Args:
            default_timeout: Default timeout in seconds (1 hour)
        """
        self._tasks: Dict[str, asyncio.Task] = {}
        self._task_timeouts: Dict[str, asyncio.Task] = {}
        self._lock = threading.Lock()
        self.default_timeout = default_timeout
    
    def _get_key(self, creation_id: str, step_name: str) -> str:
        """Generate task key for tracking."""
        return f"{creation_id}:{step_name}"
    
    def create_task(
        self, 
        creation_id: str, 
        step_name: str, 
        coro: Coroutine, 
        timeout: Optional[int] = None
    ) -> asyncio.Task:
        """
        Create task with timeout and auto-cleanup.
        
        Args:
            creation_id: Creation ID
            step_name: Step name
            coro: Coroutine to execute
            timeout: Timeout in seconds (uses default if None)
        
        Returns:
            Created asyncio.Task
        """
        key = self._get_key(creation_id, step_name)
        timeout_seconds = timeout or self.default_timeout
        
        with self._lock:
            # Cancel existing task if any
            if key in self._tasks:
                old_task = self._tasks[key]
                if not old_task.done():
                    logger.warning(f"[{creation_id}] Cancelling existing task for step {step_name}")
                    old_task.cancel()
            
            # Create main task
            task = asyncio.create_task(coro)
            self._tasks[key] = task
            
            # Create timeout task
            async def timeout_handler():
                await asyncio.sleep(timeout_seconds)
                if not task.done():
                    logger.warning(f"[{creation_id}] Task {step_name} timed out after {timeout_seconds}s, cancelling...")
                    task.cancel()
                    # Mark step as failed in DB
                    db = SessionLocal()
                    try:
                        step = db.query(CreationStep).filter(
                            CreationStep.creation_id == creation_id,
                            CreationStep.step_name == step_name
                        ).first()
                        if step and step.status == "processing":
                            step.status = "failed"
                            step.error_message = f"Step timed out after {timeout_seconds} seconds"
                            db.commit()
                            logger.info(f"[{creation_id}] Marked step {step_name} as failed (timeout)")
                    except Exception as e:
                        logger.error(f"[{creation_id}] Error marking timed-out step as failed: {e}")
                    finally:
                        db.close()
            
            timeout_task = asyncio.create_task(timeout_handler())
            self._task_timeouts[key] = timeout_task
            
            # Auto-cleanup
            def cleanup(t: asyncio.Task):
                with self._lock:
                    self._tasks.pop(key, None)
                    timeout_task = self._task_timeouts.pop(key, None)
                    if timeout_task and not timeout_task.done():
                        timeout_task.cancel()
            
            task.add_done_callback(cleanup)
            logger.info(f"[{creation_id}] Created task for step {step_name} (timeout: {timeout_seconds}s)")
            return task
    
    def cancel_task(self, creation_id: str, step_name: str) -> bool:
        """
        Cancel task if exists and running.
        
        Args:
            creation_id: Creation ID
            step_name: Step name
        
        Returns:
            True if task was found and cancelled, False otherwise
        """
        key = self._get_key(creation_id, step_name)
        with self._lock:
            task = self._tasks.get(key)
            if task and not task.done():
                task.cancel()
                logger.info(f"[{creation_id}] Cancelled task for step {step_name}")
                return True
        return False
    
    def is_running(self, creation_id: str, step_name: str) -> bool:
        """
        Check if step has running task.
        
        Args:
            creation_id: Creation ID
            step_name: Step name
        
        Returns:
            True if task is running, False otherwise
        """
        key = self._get_key(creation_id, step_name)
        with self._lock:
            task = self._tasks.get(key)
            return task is not None and not task.done()
    
    def cancel_all_tasks_for_creation(self, creation_id: str) -> int:
        """
        Cancel all tasks for a creation.
        
        Args:
            creation_id: Creation ID
        
        Returns:
            Number of tasks cancelled
        """
        cancelled = 0
        with self._lock:
            keys_to_cancel = [
                key for key in self._tasks.keys()
                if key.startswith(f"{creation_id}:")
            ]
            for key in keys_to_cancel:
                task = self._tasks[key]
                if not task.done():
                    task.cancel()
                    cancelled += 1
                    step_name = key.split(":", 1)[1] if ":" in key else "unknown"
                    logger.info(f"[{creation_id}] Cancelled task for step {step_name}")
        return cancelled
    
    def cancel_all_tasks(self) -> int:
        """
        Cancel all tasks. Used during shutdown.

        Returns:
            Number of tasks cancelled
        """
        cancelled = 0
        with self._lock:
            for key, task in self._tasks.items():
                if not task.done():
                    task.cancel()
                    cancelled += 1
            logger.info(f"Cancelled {cancelled} tasks during shutdown")
        return cancelled

    def get_all_tasks(self) -> list:
        """
        Get all tasks (for shutdown waiting).
        Returns list of all tasks.
        """
        with self._lock:
            return list(self._tasks.values())


def set_task_manager(manager: Optional['TaskManager']) -> None:
    """Set the global TaskManager instance (called from main.py lifespan)."""
    global _task_manager
    _task_manager = manager


def get_task_manager() -> 'TaskManager':
    """Get the global TaskManager instance (for FastAPI dependencies)."""
    if _task_manager is None:
        raise RuntimeError("TaskManager not initialized. This should be set in app lifespan.")
    return _task_manager
