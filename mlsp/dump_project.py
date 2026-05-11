#!/usr/bin/env python3
"""
Project dumper script - outputs entire project structure and file contents to a txt file
"""

import os
import sys
from pathlib import Path


def should_ignore(path, ignore_dirs=None):
    """Check if a path should be ignored"""
    if ignore_dirs is None:
        ignore_dirs = {
            'node_modules',
            '.git',
            '.venv',
            'venv',
            'dist',
            'build',
            '__pycache__',
            '.next',
            'coverage',
            '.pytest_cache',
            '.turbo',
            'out',
        }
    
    parts = Path(path).parts
    return any(part in ignore_dirs for part in parts)


def is_binary_file(filepath):
    """Check if a file is binary"""
    binary_extensions = {
        '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico',
        '.mp3', '.mp4', '.wav', '.webm', '.mov', '.avi',
        '.zip', '.tar', '.gz', '.rar', '.7z',
        '.exe', '.dll', '.so', '.dylib',
        '.pdf', '.doc', '.docx', '.xls', '.xlsx',
        '.pyc', '.o', '.a', '.lib',
    }
    
    ext = Path(filepath).suffix.lower()
    if ext in binary_extensions:
        return True
    
    try:
        with open(filepath, 'rb') as f:
            chunk = f.read(512)
            return b'\x00' in chunk
    except Exception:
        return True


def dump_project(root_path='.', output_file='project_dump.txt', max_file_size=1000000):
    """
    Dump entire project structure and contents to a txt file
    
    Args:
        root_path: Root directory to start dumping from
        output_file: Output txt filename
        max_file_size: Maximum file size to dump (in bytes)
    """
    
    root = Path(root_path)
    
    with open(output_file, 'w', encoding='utf-8', errors='replace') as f:
        f.write(f"{'='*80}\n")
        f.write(f"PROJECT DUMP - {root.absolute()}\n")
        f.write(f"{'='*80}\n\n")
        
        file_count = 0
        skipped_count = 0
        
        # Walk through all files
        for filepath in sorted(root.rglob('*')):
            if should_ignore(str(filepath)):
                continue
            
            relative_path = filepath.relative_to(root)
            
            if filepath.is_dir():
                continue
            
            if is_binary_file(filepath):
                f.write(f"\n[BINARY FILE - SKIPPED] {relative_path}\n")
                skipped_count += 1
                continue
            
            try:
                file_size = filepath.stat().st_size
                if file_size > max_file_size:
                    f.write(f"\n[FILE TOO LARGE - SKIPPED] {relative_path} ({file_size} bytes)\n")
                    skipped_count += 1
                    continue
                
                f.write(f"\n{'='*80}\n")
                f.write(f"FILE: {relative_path}\n")
                f.write(f"{'='*80}\n")
                
                with open(filepath, 'r', encoding='utf-8', errors='replace') as src:
                    f.write(src.read())
                
                f.write("\n")
                file_count += 1
                
            except Exception as e:
                f.write(f"\n[ERROR READING FILE] {relative_path}: {str(e)}\n")
                skipped_count += 1
        
        # Summary
        f.write(f"\n{'='*80}\n")
        f.write(f"DUMP SUMMARY\n")
        f.write(f"{'='*80}\n")
        f.write(f"Files dumped: {file_count}\n")
        f.write(f"Files skipped: {skipped_count}\n")
        f.write(f"Output file: {output_file}\n")
    
    print(f"✓ Project dumped to {output_file}")
    print(f"  - Files included: {file_count}")
    print(f"  - Files skipped: {skipped_count}")


if __name__ == '__main__':
    # Optional: specify custom output filename via command line
    output = sys.argv[1] if len(sys.argv) > 1 else 'project_dump.txt'
    dump_project(output_file=output)
