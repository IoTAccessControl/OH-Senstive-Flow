import re
import os

file_path = r"f:\HarmonyOS\微调数据集\firstphase.json"

try:
    if os.path.exists(file_path):
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Regex to find array boundaries with standard or Chinese comma
        # Pattern: closing bracket ], optional whitespace, optional comma, optional whitespace, optional Chinese comma, opening bracket [
        # This will merge arrays: [ ... ] , [ ... ] -> [ ... , ... ]
        # The comma is added at the end of the first object in the new merged list.
        
        # We replace "]\s*[，,]\s*\[" with ","
        # Also handle potential missing commas if files were just concatenated: "]\s*\[" -> ","
        
        new_content = re.sub(r'\]\s*(?:[，,])?\s*\[', ',', content)
        
        if content != new_content:
            print("Found and merged array boundaries.")
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(new_content)
        else:
            print("No array merging patterns found.")
    else:
        print(f"File not found: {file_path}")

except Exception as e:
    print(f"Error processing file: {e}")
