import json
import os

class Phase1Dataset:
    """
    A Dataset loader specifically for the complex structure of firstphase.json.
    It formats the nested 'input' object into a structured string prompt.
    """
    def __init__(self, data_path, template=None):
        self.data_path = data_path
        # Use a template that fits the chat format
        self.template = template if template else "User: {input}\nAssistant: {output}"
        self.data = []
        
        self.load_data()

    def format_input(self, input_obj):
        """
        Formats the complex input dictionary into a readable string.
        """
        if isinstance(input_obj, str):
            return input_obj

        # Extract main fields
        flow_id = input_obj.get('id', 'N/A')
        data_type = input_obj.get('data_type', 'N/A')
        description = input_obj.get('description', 'N/A')
        flow_steps = input_obj.get('flow_steps', [])

        # Build the formatted string
        formatted_parts = []
        formatted_parts.append(f"[Input Data]")
        formatted_parts.append(f"ID: {flow_id}")
        formatted_parts.append(f"Data Type: {data_type}")
        formatted_parts.append(f"Description: {description}")
        formatted_parts.append(f"\n[Flow Steps]")

        for idx, step in enumerate(flow_steps, 1):
            s_name = step.get('step', 'N/A')
            s_func = step.get('function', 'N/A')
            s_file = step.get('file', 'N/A')
            s_line = step.get('line', 'N/A')
            s_code = step.get('code', 'N/A')
            s_details = step.get('details', 'N/A')

            step_str = (
                f"{idx}. Step: {s_name}\n"
                f"   Function: {s_func}\n"
                f"   File: {s_file} (Line {s_line})\n"
                f"   Code: {s_code}\n"
                f"   Details: {s_details}"
            )
            formatted_parts.append(step_str)

        return "\n".join(formatted_parts)

    def load_data(self):
        try:
            if not os.path.exists(self.data_path):
                print(f"Error: File not found at {self.data_path}")
                return

            with open(self.data_path, 'r', encoding='utf-8') as f:
                raw_data = json.load(f)
            
            print(f"[Dataset Info] Successfully loaded {len(raw_data)} records from {self.data_path}.")
            
            # Convert raw input/output -> formatted training samples
            for i, item in enumerate(raw_data):
                input_obj = item.get('input', {})
                output_text = item.get('output', '').strip()
                
                # Format the input object into a string
                formatted_input = self.format_input(input_obj)
                
                if formatted_input and output_text:
                    # Construct full prompt
                    full_prompt = self.template.format(input=formatted_input, output=output_text)
                    
                    self.data.append({
                        "id": i,
                        "raw_input": input_obj,
                        "raw_output": output_text,
                        "formatted_input_str": formatted_input,
                        "formatted_text": full_prompt
                    })
                    
        except json.JSONDecodeError as e:
            print(f"Error: Invalid JSON format - {e}")
        except Exception as e:
            print(f"Error loading data: {e}")

    def __len__(self):
        return len(self.data)

    def __getitem__(self, idx):
        return self.data[idx]

    def split_train_val(self, val_ratio=0.1):
        split_idx = int(len(self.data) * (1 - val_ratio))
        return self.data[:split_idx], self.data[split_idx:]

if __name__ == "__main__":
    # Test with the specific file
    dataset_path = r"f:\HarmonyOS\微调数据集\firstphase.json"
    
    # Initialize dataset
    ds = Phase1Dataset(dataset_path)
    
    if len(ds) > 0:
        print(f"\n--- Sample Record 0 ---")
        item = ds[0]
        print(f"Formatted Text Preview:\n{item['formatted_text'][:1000]}...") # Print first 1000 chars
        
        print(f"\n--- Total Records: {len(ds)} ---")
    else:
        print("No records loaded.")
