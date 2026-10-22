# ChatWrapped

ChatWrapped is a Node.js backend that summarizes iMessage conversations using OpenRouter's GPT-4o model. It parses iMessage export files (.txt or .csv), sends the plain text to GPT with a specific prompt, and displays or saves the raw JSON response.

## Exporting Messages

This project expects iMessage data exported using **Backup Viewer**. Export your messages as a CSV file.

### Example CSV Format

| date       | sender        | received | imessage | text                      |
|------------|--------------|----------|----------|---------------------------|
| 5/26/2025  | +15153040387  |          | Yes      | Do you want one or not    |

- **date**: The date of the message
- **sender**: The phone number or contact name
- **received**: (optional) indicator if the message was received
- **imessage**: (optional) indicator if the message was sent via iMessage
- **text**: The message content

## Setup

1. Install dependencies:
   ```bash
   npm install
   pip install pandas
   ```
2. Set your  API key in a `.env` file:
   ```env
   API_KEY=your_api_key_here
   ```
3. Start the server:
   ```bash
   node index.js
   ```

## Usage
1. Make a backup of your iPhone (I used iMazing) and exported the messages as a csv file with iBackup Viewer.
2. Upload your csv 
3. run clean.py
4. Add api key in .env 
5. Send a POST request to `/upload` with your exported chat file as `chatfile` (form-data):
```bash
curl -F "chatfile=@name.csv" http://localhost:3000/upload
```

The server will return a JSON summary of your chat.

curl -F "chatfile=@C:\Users\rison\Desktop\Codes\VS\ChatWrapped\name.csv" http://localhost:3000/upload