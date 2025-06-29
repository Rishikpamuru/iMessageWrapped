const express = require('express');
const multer = require('multer');
const fs = require('fs');
const axios = require('axios');
const { parse } = require('csv-parse/sync');
const path = require('path');
require('dotenv').config(); // Load .env

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.json());

// Parse CSV or plaintext file
function parseFile(filePath, mimetype) {
  const content = fs.readFileSync(filePath, 'utf8');
  if (mimetype === 'text/csv' || filePath.endsWith('.csv')) {
    const records = parse(content, { columns: false, skip_empty_lines: true });
    return records.map(row => row.join(' ')).join('\n');
  }
  return content;
}

app.post('/upload', upload.single('chatfile'), async (req, res) => {
  try {
    const file = req.file;
    console.log('📥 Received file:', file?.originalname || '[No file]');

    if (!file) {
      console.warn('⚠️ No file uploaded');
      return res.status(400).json({ success: false, error: 'No file uploaded.' });
    }

    const chatText = parseFile(file.path, file.mimetype);
    fs.unlinkSync(file.path); // Cleanup

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error('❌ API key missing');
      return res.status(500).json({ success: false, error: 'OpenAI API key not set.' });
    }

    const prompt = `You are an emotionally intelligent AI analyzing relationship dynamics from chat logs. Generate a “Chat Wrapped” summary in raw JSON only.\nReturn: { "interest_level": { "you": %, "them": % }, "compatibility_score": %, "message_count": { "you": count, "them": count }, "red_flags": ["flag1","flag2","flag3"], "top_words": { "you": ["w1","w2","w3","w4","w5"], "them": ["w1","w2","w3","w4","w5"] }, "attachment_style": { "you": "Anxious"|"Secure"|"Avoidant", "them": "Anxious"|"Secure"|"Avoidant" }, "sentiment_score": { "you": {"positive": %, "neutral": %, "negative": %}, "them": {"positive": %, "neutral": %, "negative": %} }, "emotional_intensity": { "you": "low"|"medium"|"high", "them": "low"|"medium"|"high" }, "conversation_topics": ["topic1","topic2","topic3"], "humor_usage": { "you": "%", "them": "%" }, "dominance_balance": { "you": "%", "them": "%" }, "conflict_frequency": count, "supportiveness_score": { "you": "%", "them": "%" }, "message_length_avg": { "you": "avg words", "them": "avg words" } }.\nUse a slightly humorous tone but ensure numbers reflect the chat content.\nHere is the iMessage chat: ${chatText}`;

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }]
        // response_format removed
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('✅ OpenAI request successful');
    res.json({ success: true, data: response.data });

  } catch (err) {
    console.error('❌ Server Error:', err.message);
    if (err.response?.data) {
      console.error('🔍 OpenAI Response:', err.response.data);
    }

    res.status(500).json({
      success: false,
      error: err.message,
      details: err.response?.data || null
    });
  }
});

app.listen(3000, () => {
  console.log('🚀 Server running on http://localhost:3000');
});
