import pandas as pd
import sys
import json
from datetime import datetime

def main():
    in_path = sys.argv[1] if len(sys.argv) > 1 else 'name.csv'
    out_path = sys.argv[2] if len(sys.argv) > 2 else 'name_clean.csv'

    # Read raw export without headers and assign common names
    df = pd.read_csv(in_path, header=None, names=['Date', 'Sender', 'Delivered', 'Read', 'Message'])

    # Compute earliest date before dropping for reporting
    earliest = None
    if 'Date' in df.columns:
        # Attempt to parse common iMessage formats
        def parse_dt(x):
            try:
                return pd.to_datetime(x, errors='coerce', infer_datetime_format=True)
            except Exception:
                return pd.NaT
        dates = df['Date'].apply(parse_dt)
        if dates.notna().any():
            earliest_dt = dates.min()
            if pd.notna(earliest_dt):
                earliest = earliest_dt.isoformat()
    
    # Remove common system messages and attachments FIRST
    sys_pat = r'^(Liked|Loved|Disliked|Laughed at|Emphasized) a message|\[Image\]|\[Sticker\]|\[Audio\]|Attachment omitted|\[Video\]|\[File\]'
    if 'Message' in df.columns:
        mask = df['Message'].astype(str).str.contains(sys_pat, regex=True, na=False)
        df = df[~mask]
        # Normalize whitespace
        df['Message'] = df['Message'].astype(str).str.replace(r'\s+', ' ', regex=True).str.strip()

    # Keep only the most recent N rows to stay within prompt budget
    df = df.tail(20000)
    
    # After truncation, get the cutoff date (earliest of the kept rows)
    cutoff = None
    if 'Date' in df.columns:
        def parse_dt(x):
            try:
                return pd.to_datetime(x, errors='coerce', infer_datetime_format=True)
            except Exception:
                return pd.NaT
        dates = df['Date'].apply(parse_dt)
        if dates.notna().any():
            cutoff_dt = dates.min()
            if pd.notna(cutoff_dt):
                cutoff = cutoff_dt.isoformat()

    # Extract digits from Sender and find minimal suffix length for unique IDs
    if 'Sender' in df.columns:
        df['Sender'] = df['Sender'].astype(str).str.replace(r'\D', '', regex=True)
        unique_senders = df['Sender'].unique()
        unique_senders = [s for s in unique_senders if s]  # drop empty
        
        # Find minimum suffix length needed to distinguish all senders
        suffix_len = 1
        while suffix_len <= 15:
            suffixes = [s[-suffix_len:] if len(s) >= suffix_len else s for s in unique_senders]
            if len(suffixes) == len(set(suffixes)):
                break
            suffix_len += 1
        
        # Apply minimal suffix to all rows
        df['Sender'] = df['Sender'].str[-suffix_len:].fillna('')
        sender_ids = sorted(set(df['Sender'].tolist()))
        sender_ids = [sid for sid in sender_ids if sid]
    else:
        suffix_len = 0
        sender_ids = []

    # Drop metadata to reduce tokens
    for col in ['Delivered', 'Read', 'Date']:
        if col in df.columns:
            df = df.drop(columns=col)

    # Write cleaned output
    df.to_csv(out_path, index=False)

    # Print JSON metadata to stdout for the caller (Node) to capture
    metadata = {
        'earliestDate': earliest or '',
        'cutoffDate': cutoff or '',
        'senderIds': sender_ids,
        'suffixLength': suffix_len
    }
    print(json.dumps(metadata))

if __name__ == '__main__':
    main()
