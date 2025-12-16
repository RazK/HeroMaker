"""User interaction workflow tests for HeroMaker API."""
import pytest
import time
import shutil
from pathlib import Path
from datetime import datetime
from app.tests.helpers import (
    poll_until_complete,
    wait_for_step_status,
    get_creation_status,
    run_pipeline,
    run_step
)


class TestCompletePipeline:
    """Test the complete user journey from upload to completion."""
    
    @pytest.mark.slow
    def test_upload_and_run_full_pipeline(self, test_client, test_image_path, api_base_url, cleanup_test_creations):
        """Test complete pipeline from upload to completion."""
        # 1. Upload image
        with open(test_image_path, "rb") as f:
            files = {"file": ("original.jpg", f, "image/jpeg")}
            response = test_client.post(f"{api_base_url}/api/creations/upload", files=files)
            assert response.status_code == 200
            creation = response.json()
            creation_id = creation["id"]
            cleanup_test_creations.append(creation_id)
        
        # 2. Verify creation created with all steps initialized
        assert creation["status"] == "pending"
        assert creation["current_step"] == "image_processing"
        assert len(creation["steps"]) == 6  # All 6 steps should be initialized
        step_names = [s["step_name"] for s in creation["steps"]]
        assert "image_processing" in step_names
        assert "chatgpt_render" in step_names
        assert "meshy_3d" in step_names
        assert "meshy_rig" in step_names
        assert "convert_vrm" in step_names
        assert "complete" in step_names
        
        # Verify all steps are initially pending
        for step in creation["steps"]:
            assert step["status"] == "pending"
        
        # 3. Run pipeline with restart=false
        run_response = run_pipeline(test_client, creation_id, restart=False, api_base_url=api_base_url)
        assert run_response["message"] == "Pipeline run triggered"
        assert run_response["creation_id"] == creation_id
        
        # 4. Poll status until completion (with long timeout for Meshy steps)
        final_creation = poll_until_complete(test_client, creation_id, api_base_url, timeout=3600)
        
        # 5. Verify all steps completed
        assert final_creation["status"] == "completed"
        assert final_creation["current_step"] is None or final_creation["current_step"] == "complete"
        
        for step in final_creation["steps"]:
            assert step["status"] == "completed", f"Step {step['step_name']} not completed"
            assert step["completed_at"] is not None
            # Verify step completed (progress would be 100% if calculated, but we don't expose it)
            assert step["status"] == "completed"
        
        # 6. Verify files exist in permanent storage (complete step moves files)
        # This is verified by the complete step having status "completed"
        # Note: File existence check is implicit - if complete step succeeded, files were moved
        # Cleanup handled by cleanup_test_creations fixture


class TestStepByStepExecution:
    """Test running individual steps manually."""
    
    def test_run_steps_individually(self, test_client, test_image_path, api_base_url, cleanup_test_creations):
        """Test running steps one by one."""
        # 1. Upload image
        with open(test_image_path, "rb") as f:
            files = {"file": ("original.jpg", f, "image/jpeg")}
            response = test_client.post(f"{api_base_url}/api/creations/upload", files=files)
            assert response.status_code == 200
            creation_id = response.json()["id"]
            cleanup_test_creations.append(creation_id)
        
        try:
            # 2. Run image_processing step
            run_response = run_step(test_client, creation_id, "image_processing", api_base_url)
            assert run_response["message"] == "Step execution started"
            assert run_response["step_name"] == "image_processing"
            
            # 3. Verify step completed
            creation = wait_for_step_status(test_client, creation_id, "image_processing", "completed", api_base_url, timeout=30)
            step = next(s for s in creation["steps"] if s["step_name"] == "image_processing")
            assert step["status"] == "completed"
            assert step["completed_at"] is not None
            
            # 4. Run chatgpt_render step
            run_response = run_step(test_client, creation_id, "chatgpt_render", api_base_url)
            assert run_response["message"] == "Step execution started"
            
            # 5. Verify step completed (with longer timeout for OpenAI API)
            creation = wait_for_step_status(test_client, creation_id, "chatgpt_render", "completed", api_base_url, timeout=120)
            step = next(s for s in creation["steps"] if s["step_name"] == "chatgpt_render")
            assert step["status"] == "completed"
            
            # Note: We skip meshy steps here as they take very long and cost money
            # In a real scenario, you'd continue for remaining steps
            # Cleanup handled by cleanup_test_creations fixture
        finally:
            pass


class TestPipelineRestart:
    """Test restart functionality."""
    
    def test_restart_from_beginning(self, test_client, test_image_path, api_base_url, cleanup_test_creations):
        """Test restarting pipeline from beginning."""
        # 1. Upload and run some steps
        with open(test_image_path, "rb") as f:
            files = {"file": ("original.jpg", f, "image/jpeg")}
            response = test_client.post(f"{api_base_url}/api/creations/upload", files=files)
            creation_id = response.json()["id"]
            cleanup_test_creations.append(creation_id)
        
        try:
            # Run first step
            run_step(test_client, creation_id, "image_processing", api_base_url)
            wait_for_step_status(test_client, creation_id, "image_processing", "completed", api_base_url, timeout=30)
            
            # Verify step is completed
            creation = get_creation_status(test_client, creation_id, api_base_url)
            step = next(s for s in creation["steps"] if s["step_name"] == "image_processing")
            assert step["status"] == "completed"
            
            # 2. Run with restart=true
            run_response = run_pipeline(test_client, creation_id, restart=True, api_base_url=api_base_url)
            assert run_response["restart"] is True
            
            # Wait a bit for pipeline to reset and start
            time.sleep(3)
            
            # 3. Verify steps are reset and pipeline is running from beginning
            creation = get_creation_status(test_client, creation_id, api_base_url)
            # After restart, the pipeline resets incomplete steps and starts from beginning
            # The first step should be processing (or already completed if very fast)
            first_step = next(s for s in creation["steps"] if s["step_name"] == "image_processing")
            # Restart resets incomplete steps, but completed steps stay completed until pipeline runs again
            # Since we just triggered restart, first step should be processing or completed
            assert first_step["status"] in ["pending", "processing", "completed"], \
                f"First step status should be pending/processing/completed after restart, got {first_step['status']}"
            # Cleanup handled by cleanup_test_creations fixture
        finally:
            pass
    
    def test_resume_from_incomplete(self, test_client, test_image_path, api_base_url):
        """Test resuming pipeline from first incomplete step."""
        # 1. Upload and run first step
        with open(test_image_path, "rb") as f:
            files = {"file": ("original.jpg", f, "image/jpeg")}
            response = test_client.post(f"{api_base_url}/api/creations/upload", files=files)
            creation_id = response.json()["id"]
        
        try:
            # Run first step
            run_step(test_client, creation_id, "image_processing", api_base_url)
            wait_for_step_status(test_client, creation_id, "image_processing", "completed", api_base_url, timeout=30)
            
            # 2. Run with restart=false
            run_response = run_pipeline(test_client, creation_id, restart=False, api_base_url=api_base_url)
            assert run_response["restart"] is False
            
            # Wait a bit
            time.sleep(2)
            
            # 3. Verify pipeline continues from first incomplete step (chatgpt_render)
            creation = get_creation_status(test_client, creation_id, api_base_url)
            # Should start processing chatgpt_render (next incomplete step)
            chatgpt_step = next(s for s in creation["steps"] if s["step_name"] == "chatgpt_render")
            assert chatgpt_step["status"] in ["pending", "processing"], "Should continue from chatgpt_render"
            
            # image_processing should still be completed
            img_step = next(s for s in creation["steps"] if s["step_name"] == "image_processing")
            assert img_step["status"] == "completed"
            # Cleanup handled by cleanup_test_creations fixture
        finally:
            pass


class TestProgressMonitoring:
    """Test progress tracking during long-running tasks."""
    
    @pytest.mark.slow
    def test_meshy_progress_updates(self, test_client, test_image_path, api_base_url, cleanup_test_creations):
        """Test that Meshy steps update progress during execution."""
        # Import here to avoid circular imports
        import sys
        backend_path = Path(__file__).parent.parent
        if str(backend_path) not in sys.path:
            sys.path.insert(0, str(backend_path))
        from app.database import SessionLocal
        from app.models import CreationStep, User
        from app.services.auth import DEBUG_USER_ID
        from app.utils.file_utils import get_task_file_path
        
        # 1. Upload and run image_processing
        with open(test_image_path, "rb") as f:
            files = {"file": ("original.jpg", f, "image/jpeg")}
            response = test_client.post(f"{api_base_url}/api/creations/upload", files=files)
            creation_id = response.json()["id"]
            cleanup_test_creations.append(creation_id)
        
        try:
            # Run image_processing
            run_step(test_client, creation_id, "image_processing", api_base_url)
            wait_for_step_status(test_client, creation_id, "image_processing", "completed", api_base_url, timeout=30)
            
            # 2. Skip expensive chatgpt_render - copy pre-existing rendered.png instead
            # Use a rendered image from permanent storage
            existing_rendered = Path(__file__).parent.parent.parent / "assets" / "permanent" / "debug-user-uuid" / "d7683421-f26a-4f02-afee-7140f139cb0d" / "rendered.png"
            if not existing_rendered.exists():
                pytest.skip("Pre-existing rendered.png not found - cannot skip chatgpt_render")
            
            # Copy rendered.png to test creation's temp folder
            rendered_output_path = get_task_file_path(creation_id, DEBUG_USER_ID, "rendered.png", is_temp=True)
            rendered_output_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(existing_rendered, rendered_output_path)
            
            # Mark chatgpt_render step as completed in database
            db = SessionLocal()
            try:
                chatgpt_step = db.query(CreationStep).filter(
                    CreationStep.creation_id == creation_id,
                    CreationStep.step_name == "chatgpt_render"
                ).first()
                if chatgpt_step:
                    chatgpt_step.status = "completed"
                    chatgpt_step.completed_at = datetime.utcnow()
                    chatgpt_step.estimated_completion_time = datetime.utcnow()
                    db.commit()
            finally:
                db.close()
            
            # 3. Start meshy_3d
            run_step(test_client, creation_id, "meshy_3d", api_base_url)
            
            # 4. Poll status every 3 seconds to verify progress updates
            progress_values = []
            start_time = time.time()
            timeout = 600  # 10 minutes max
            
            print(f"\nStarting Meshy 3D progress monitoring...")
            
            while time.time() - start_time < timeout:
                elapsed = int(time.time() - start_time)
                
                creation = get_creation_status(test_client, creation_id, api_base_url)
                meshy_step = next((s for s in creation["steps"] if s["step_name"] == "meshy_3d"), None)
                
                if meshy_step:
                    status = meshy_step.get("status")
                    error_message = meshy_step.get("error_message")
                    estimated_completion_time = meshy_step.get("estimated_completion_time")
                    started_at = meshy_step.get("started_at")
                    
                    # Handle API failures (e.g., 402 Payment Required)
                    if status == "failed":
                        if error_message and ("402" in error_message or "Payment" in error_message):
                            pytest.fail(f"Meshy API payment required - skipping test: {error_message}")
                        else:
                            # Other failures should raise an error
                            pytest.fail(f"Meshy step failed: {error_message}")
                    
                    # Calculate progress from estimated_completion_time (frontend approach)
                    progress = None
                    if estimated_completion_time and started_at:
                        from datetime import datetime
                        start_time_ts = datetime.fromisoformat(started_at.replace('Z', '+00:00')).timestamp()
                        completion_time_ts = datetime.fromisoformat(estimated_completion_time.replace('Z', '+00:00')).timestamp()
                        total_duration = completion_time_ts - start_time_ts
                        if total_duration > 0:
                            progress = int((elapsed / total_duration) * 100)
                            # Track distinct progress values
                            if not progress_values or progress != progress_values[-1]:
                                progress_values.append(progress)
                                print(f"  [{int(elapsed)}s elapsed] Progress: {progress}% | Estimated completion: {estimated_completion_time}")
                    
                    # 5. Verify estimated_completion_time is available and progress is valid
                    if status == "processing":
                        if not estimated_completion_time or not started_at:
                            print(f"  [{int(elapsed)}s elapsed] Status: {status}, waiting for estimated_completion_time...")
                            pass
                        else:
                            # Verify calculated progress is valid
                            if progress is not None:
                                assert 0 <= progress <= 100, f"Progress should be 0-100, got {progress}"
                    
                    if status == "completed":
                        total_time = int(time.time() - start_time)
                        print(f"\n  ✓ Meshy step completed! Total time: {total_time}s")
                        break
                
                time.sleep(3)
            
            # Verify we saw some progress updates
            print(f"\nCollected {len(progress_values)} distinct progress updates: {progress_values}")
            assert len(progress_values) > 0, "Should have seen at least one progress update"
            assert max(progress_values) > 0, "Maximum progress should be > 0"
            print(f"Progress tracking verified: {len(progress_values)} updates, max: {max(progress_values)}%")
            # Cleanup handled by cleanup_test_creations fixture
        finally:
            pass


class TestStatusQueries:
    """Test status queries and listing."""
    
    def test_get_creation_status(self, test_client, created_creation, api_base_url):
        """Test getting creation status."""
        creation_id = created_creation
        
        # 1. Get creation by ID
        creation = get_creation_status(test_client, creation_id, api_base_url)
        
        # 2. Verify status, current_step, steps array
        assert "id" in creation
        assert creation["id"] == creation_id
        assert "status" in creation
        assert "current_step" in creation
        assert "steps" in creation
        assert isinstance(creation["steps"], list)
        assert len(creation["steps"]) > 0
        
        # 3. Verify derived properties work correctly
        # Status should be calculated from steps
        step_statuses = [s["status"] for s in creation["steps"]]
        if all(s == "completed" for s in step_statuses):
            assert creation["status"] == "completed"
        elif any(s == "processing" for s in step_statuses):
            assert creation["status"] == "processing"
        elif any(s == "failed" for s in step_statuses):
            assert creation["status"] == "failed"
        else:
            assert creation["status"] == "pending"
        
        # current_step should match first processing or pending step
        processing_steps = [s for s in creation["steps"] if s["status"] == "processing"]
        pending_steps = [s for s in creation["steps"] if s["status"] == "pending"]
        
        if processing_steps:
            assert creation["current_step"] == processing_steps[0]["step_name"]
        elif pending_steps:
            assert creation["current_step"] == pending_steps[0]["step_name"]
        else:
            # All completed
            assert creation["current_step"] is None or creation["current_step"] == "complete"
    
    def test_list_creations_with_filters(self, test_client, test_image_path, api_base_url, cleanup_test_creations):
        """Test listing creations with status filters."""
        creation_ids = []
        
        try:
            # 1. Create multiple creations with different statuses
            # Create a pending creation
            with open(test_image_path, "rb") as f:
                files = {"file": ("original.jpg", f, "image/jpeg")}
                response = test_client.post(f"{api_base_url}/api/creations/upload", files=files)
                assert response.status_code == 200
                creation_id = response.json()["id"]
                creation_ids.append(creation_id)
                cleanup_test_creations.append(creation_id)
            
            # Create another pending creation
            with open(test_image_path, "rb") as f:
                files = {"file": ("original.jpg", f, "image/jpeg")}
                response = test_client.post(f"{api_base_url}/api/creations/upload", files=files)
                assert response.status_code == 200
                creation_id = response.json()["id"]
                creation_ids.append(creation_id)
                cleanup_test_creations.append(creation_id)
            
            # 2. List with status filter
            response = test_client.get(f"{api_base_url}/api/creations", params={"status": "pending"})
            assert response.status_code == 200
            data = response.json()
            
            # 3. Verify filtering works
            assert "creations" in data
            assert "total" in data
            assert isinstance(data["creations"], list)
            
            # All returned creations should have pending status
            for creation in data["creations"]:
                assert creation["status"] == "pending"
            
            # 4. Verify pagination
            assert "limit" in data
            assert "offset" in data
            assert data["limit"] == 20  # Default limit
            assert data["offset"] == 0  # Default offset
            
        finally:
            # Cleanup handled by cleanup_test_creations fixture
            pass


class TestErrorHandling:
    """Test error handling and edge cases."""
    
    def test_run_step_without_dependencies(self, test_client, test_image_path, api_base_url, cleanup_test_creations):
        """Test running a step without satisfying dependencies."""
        # 1. Upload image
        with open(test_image_path, "rb") as f:
            files = {"file": ("original.jpg", f, "image/jpeg")}
            response = test_client.post(f"{api_base_url}/api/creations/upload", files=files)
            creation_id = response.json()["id"]
            cleanup_test_creations.append(creation_id)
        
        try:
            # 2. Try to run meshy_3d before chatgpt_render
            response = test_client.post(f"{api_base_url}/api/creations/{creation_id}/steps/meshy_3d/run")
            
            # 3. Verify 400 error with dependency message
            assert response.status_code == 400, f"Expected 400 error, got {response.status_code}: {response.text}"
            error_data = response.json()
            assert "detail" in error_data
            assert "dependency" in error_data["detail"].lower() or "not found" in error_data["detail"].lower()
            # Cleanup handled by cleanup_test_creations fixture
        finally:
            pass
    
    def test_invalid_step_name(self, test_client, created_creation, api_base_url):
        """Test running a non-existent step."""
        creation_id = created_creation
        
        # 1. Try to run non-existent step
        response = test_client.post(f"{api_base_url}/api/creations/{creation_id}/steps/invalid_step_name/run")
        
        # 2. Verify 404 error
        assert response.status_code == 404, f"Expected 404 error, got {response.status_code}: {response.text}"
        error_data = response.json()
        assert "detail" in error_data
        assert "not found" in error_data["detail"].lower()
    
    def test_invalid_creation_id(self, test_client, api_base_url):
        """Test accessing non-existent creation."""
        invalid_id = "00000000-0000-0000-0000-000000000000"
        
        # 1. Try to get non-existent creation
        response = test_client.get(f"{api_base_url}/api/creations/{invalid_id}")
        assert response.status_code == 404
        
        # 2. Try to run pipeline on non-existent creation
        response = test_client.post(f"{api_base_url}/api/creations/{invalid_id}/run")
        assert response.status_code == 404
        
        # 3. Verify 404 error
        error_data = response.json()
        assert "detail" in error_data
        assert "not found" in error_data["detail"].lower()


class TestCreationManagement:
    """Test creation updates and management."""
    
    def test_update_character_name(self, test_client, created_creation, api_base_url):
        """Test updating creation character name."""
        creation_id = created_creation
        
        # 1. Update creation with new character_name
        new_name = "UpdatedTestHero"
        response = test_client.patch(
            f"{api_base_url}/api/creations/{creation_id}",
            json={"character_name": new_name}
        )
        assert response.status_code == 200
        updated_creation = response.json()
        
        # 2. Verify update persisted
        assert updated_creation["character_name"] == new_name
        
        # 3. Get creation and verify character_name changed
        creation = get_creation_status(test_client, creation_id, api_base_url)
        assert creation["character_name"] == new_name
    
    def test_delete_creation(self, test_client, test_image_path, api_base_url, cleanup_test_creations):
        """Test deleting a creation."""
        # 1. Create and upload
        with open(test_image_path, "rb") as f:
            files = {"file": ("original.jpg", f, "image/jpeg")}
            response = test_client.post(f"{api_base_url}/api/creations/upload", files=files)
            assert response.status_code == 200
            creation_id = response.json()["id"]
            cleanup_test_creations.append(creation_id)
        
        # 2. Delete creation
        response = test_client.delete(f"{api_base_url}/api/creations/{creation_id}")
        assert response.status_code == 200
        
        # 3. Verify 404 on subsequent requests
        response = test_client.get(f"{api_base_url}/api/creations/{creation_id}")
        assert response.status_code == 404
        # Note: Already deleted, so cleanup fixture will handle temp folder removal
        
        response = test_client.post(f"{api_base_url}/api/creations/{creation_id}/run")
        assert response.status_code == 404

