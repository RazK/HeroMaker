#!/usr/bin/env python3
"""
Migration script to merge temp and permanent files into single location.
Moves all files from assets/temp/{user_id}/{creation_id}/ and 
assets/permanent/{user_id}/{creation_id}/ to assets/{user_id}/{creation_id}/
"""
import shutil
from pathlib import Path
import sys

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.config.settings import ASSETS_ROOT

def migrate_files():
    """Migrate files from temp/permanent to single location."""
    assets_root = Path(ASSETS_ROOT)
    temp_dir = assets_root / "temp"
    permanent_dir = assets_root / "permanent"
    
    if not temp_dir.exists() and not permanent_dir.exists():
        print("No temp or permanent directories found. Migration not needed.")
        return
    
    migrated_count = 0
    error_count = 0
    
    # Process temp directory
    if temp_dir.exists():
        for user_dir in temp_dir.iterdir():
            if not user_dir.is_dir():
                continue
            user_id = user_dir.name
            print(f"Processing temp files for user: {user_id}")
            
            for creation_dir in user_dir.iterdir():
                if not creation_dir.is_dir():
                    continue
                creation_id = creation_dir.name
                target_dir = assets_root / user_id / creation_id
                
                try:
                    # Create target directory
                    target_dir.mkdir(parents=True, exist_ok=True)
                    
                    # Move files from temp
                    for file in creation_dir.iterdir():
                        if file.is_file():
                            target_file = target_dir / file.name
                            if target_file.exists():
                                print(f"  Warning: {target_file} already exists, skipping {file.name}")
                            else:
                                shutil.move(str(file), str(target_file))
                                print(f"  Moved: {file.name}")
                    
                    # Remove empty temp directory
                    try:
                        creation_dir.rmdir()
                    except OSError:
                        pass  # Directory not empty, that's fine
                    
                    migrated_count += 1
                except Exception as e:
                    print(f"  Error migrating {creation_id}: {e}")
                    error_count += 1
    
    # Process permanent directory
    if permanent_dir.exists():
        for user_dir in permanent_dir.iterdir():
            if not user_dir.is_dir():
                continue
            user_id = user_dir.name
            print(f"Processing permanent files for user: {user_id}")
            
            for creation_dir in user_dir.iterdir():
                if not creation_dir.is_dir():
                    continue
                creation_id = creation_dir.name
                target_dir = assets_root / user_id / creation_id
                
                try:
                    # Create target directory
                    target_dir.mkdir(parents=True, exist_ok=True)
                    
                    # Move files from permanent (may overwrite files from temp)
                    for file in creation_dir.iterdir():
                        if file.is_file():
                            target_file = target_dir / file.name
                            if target_file.exists():
                                # Permanent files take precedence
                                target_file.unlink()
                                print(f"  Overwrote: {file.name} (permanent takes precedence)")
                            shutil.move(str(file), str(target_file))
                            print(f"  Moved: {file.name}")
                    
                    # Remove empty permanent directory
                    try:
                        creation_dir.rmdir()
                    except OSError:
                        pass  # Directory not empty, that's fine
                    
                    migrated_count += 1
                except Exception as e:
                    print(f"  Error migrating {creation_id}: {e}")
                    error_count += 1
    
    # Try to remove empty user directories
    for base_dir in [temp_dir, permanent_dir]:
        if base_dir.exists():
            for user_dir in base_dir.iterdir():
                if user_dir.is_dir():
                    try:
                        user_dir.rmdir()
                    except OSError:
                        pass
    
    print(f"\nMigration complete!")
    print(f"  Migrated: {migrated_count} creations")
    print(f"  Errors: {error_count}")

if __name__ == "__main__":
    migrate_files()

