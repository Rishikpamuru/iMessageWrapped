const express = require('express');
const multer = require('multer');
const fs = require('fs');
const axios = require('axios');
const { parse } = require('csv-parse/sync');
const path = require('path');
const { spawn } = require('child_process');
require('dotenv').config();

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.json());
app.use(express.static('public'));

function truncateChatText(chatText, maxChars = 40000) {
  if (!chatText || chatText.length <= maxChars) return chatText;
  const lines = chatText.split(/\r?\n/);
  let acc = [];
  let total = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const len = line.length + 1;
    if (total + len > maxChars) break;
    acc.push(line);
    total += len;
  }
  acc.reverse();
  return acc.join('\n');
}

app.post('/upload', upload.single('chatfile'), async (req, res) => {
  try {
    const file = req.file;
    console.log('📥 Received file:', file?.originalname || '[No file]');

    if (!file) {
      console.warn('⚠️ No file uploaded');
      return res.status(400).json({ success: false, error: 'No file uploaded.' });
    }

    const cleanedPath = path.join('uploads', `cleaned_${Date.now()}.csv`);
    const metadata = await new Promise((resolve) => {
      try {
        const py = spawn('C:/Python312/python.exe', [path.join(process.cwd(), 'clean.py'), file.path, cleanedPath], { shell: false });
        let stdout = '';
        py.stdout.on('data', (d) => { stdout += d.toString(); });
        py.stderr.on('data', (d) => { console.error('🐍 clean.py stderr:', d.toString()); });
        py.on('close', () => {
          try {
            resolve(JSON.parse(stdout.trim()));
          } catch {
            resolve({ earliestDate: '', senderIds: [], suffixLength: 0 });
          }
        });
      } catch (e) {
        console.error('Failed to run clean.py', e);
        resolve({ earliestDate: '', senderIds: [], suffixLength: 0 });
      }
    });

    try { fs.unlinkSync(file.path); } catch {}

    res.json({
      success: true,
      cleanedPath,
      earliestDate: metadata.earliestDate,
      cutoffDate: metadata.cutoffDate,
      senderIds: metadata.senderIds,
      suffixLength: metadata.suffixLength
    });

  } catch (err) {
    console.error('❌ Upload Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/analyze', async (req, res) => {
  try {
    const { cleanedPath, yourId } = req.body;
    if (!cleanedPath || !yourId) {
      return res.status(400).json({ success: false, error: 'Missing cleanedPath or yourId' });
    }

    const csvContent = fs.readFileSync(cleanedPath, 'utf8');
    const records = parse(csvContent, { columns: true, skip_empty_lines: true });
    
    // Determine themId
    const allSenderIds = [...new Set(records.map(r => r.Sender))];
    const themId = allSenderIds.find(id => id !== yourId) || 'unknown';
    
    // Local processing for deterministic metrics
    let messageCountYou = 0, messageCountThem = 0;
    let totalLengthYou = 0, totalLengthThem = 0;
    const wordsYou = {}, wordsThem = {};
    
    // Comprehensive stop words list
    const stopWords = new Set([
      'the','and','for','are','but','not','you','all','can','her','was','one','our','out','day','get','has','him','his','how','its','may','now','old','see','than','that','them','then','they','this','very','what','when','with','would','your','about','after','could','from','have','into','just','like','more','said','such','these','will',
      'be','been','being','do','does','did','doing','had','having','has','an','as','at','by','if','in','is','it','no','of','on','or','so','to','up','us','we','my','me','he','she','it','they','what','which','who','whom','this','that','these','those','am','are','was','were',
      'oh','ok','okay','yeah','yes','yep','nope','maybe','well','sure','fine','good','bad','lol','lmao','haha','omg','wtf','idk','tbh','imo','btw','gonna','wanna','gotta'
    ]);
    
    records.forEach(row => {
      const sender = row.Sender === yourId ? 'you' : 'them';
      const msg = (row.Message || '').trim();
      
      if (sender === 'you') {
        messageCountYou++;
        totalLengthYou += msg.length;
        // Extract words (minimum 4 characters)
        msg.toLowerCase().match(/\b[a-z]{4,}\b/gi)?.forEach(word => {
          if (!stopWords.has(word)) {
            wordsYou[word] = (wordsYou[word] || 0) + 1;
          }
        });
      } else {
        messageCountThem++;
        totalLengthThem += msg.length;
        msg.toLowerCase().match(/\b[a-z]{4,}\b/gi)?.forEach(word => {
          if (!stopWords.has(word)) {
            wordsThem[word] = (wordsThem[word] || 0) + 1;
          }
        });
      }
    });
    
    const avgLengthYou = messageCountYou > 0 ? Math.round(totalLengthYou / messageCountYou) : 0;
    const avgLengthThem = messageCountThem > 0 ? Math.round(totalLengthThem / messageCountThem) : 0;
    
    const topWordsYou = Object.entries(wordsYou).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([word, count]) => ({ word, count }));
    const topWordsThem = Object.entries(wordsThem).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([word, count]) => ({ word, count }));
    
    const labeled = records.map(row => {
      const sender = row.Sender === yourId ? 'you' : 'them';
      return `${sender}: ${row.Message}`;
    }).join('\n');

    let chatText = truncateChatText(labeled);
    try { fs.unlinkSync(cleanedPath); } catch {}

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error('❌ API key missing');
      return res.status(500).json({ success: false, error: 'OpenAI API key not set.' });
    }

    const prompt = `You are an emotionally intelligent AI analyzing relationship dynamics from chat logs.

CRITICAL: Return ONLY valid JSON. No markdown code blocks, no extra text, just pure JSON starting with { and ending with }.

IMPORTANT CONTEXT:
- "you" refers to sender ID: ${yourId} (the person who uploaded this chat and selected their ID)
- "them" refers to the other person in the conversation (sender ID: ${themId})
- When analyzing, "you" = ${yourId} and "them" = ${themId}

Return this exact JSON structure: {
  "compliment_count": { "you": count, "them": count },
  "conflict_count": { "you": count, "them": count },
  "red_flags_you": [{"icon":"emoji","text":"brief description  (be brutally honest)"},{"icon":"emoji","text":"brief description  (be brutally honest)"}],
  "red_flags_them": [{"icon":"emoji","text":"brief description (be brutally honest)"},{"icon":"emoji","text":"brief description (be brutally honest)"}],
  "green_flags_you": [{"icon":"emoji","text":"brief description"},{"icon":"emoji","text":"brief description"}],
  "green_flags_them": [{"icon":"emoji","text":"brief description"},{"icon":"emoji","text":"brief description"}],
  "attachment_style": { "you": "ie: anxious or avoidant", "you_percent": %, "them": "ie: anxious or avoidant", "them_percent": % },
  "communication_style": { "you": "brief description (be brutally honest)", "them": "brief description (be brutally honest)" },
  "energy_match": %,
  "humor_compatibility": %,
  "compatibility_score": %,
  "conversation_topics": ["topic1","topic2","topic3","topic4","topic5"],
  "vibe": "brief 1-sentence overall relationship vibe"
}

Guidelines:
- conflict_count: count total amount of disagreements, arguments, or tense exchanges.
- Be witty and slightly humorous but honest
- Use emojis for flag icons (🚩❌⚠️ for red, ✨💚✅ for green)

Here is the chat:
${chatText}`;

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }]
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    let rawContent = response.data?.choices?.[0]?.message?.content || '';
    console.log('📄 GPT Raw Response:');

    
    let summary = null;
    
    try {
      summary = JSON.parse(rawContent);
    } catch (e) {
      
      // Try extracting from markdown code blocks
      console.log('🔍 Attempting to extract JSON from markdown code blocks...');
      const jsonMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        console.log('✅ Found code block, attempting to parse...');
        try {
          summary = JSON.parse(jsonMatch[1].trim());
          console.log('✅ Successfully extracted and parsed JSON from code block');
        } catch (e2) {
          console.error('❌ Code block parse failed:', e2.message);
        }
      }
      
      // Last resort: try to find JSON object manually
      if (!summary) {
        console.log('🔍 Attempting manual JSON extraction...');
        const jsonStart = rawContent.indexOf('{');
        const jsonEnd = rawContent.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
          try {
            const extracted = rawContent.substring(jsonStart, jsonEnd + 1);
            summary = JSON.parse(extracted);
            console.log('✅ Successfully extracted JSON manually');
          } catch (e3) {
            console.error('❌ Manual extraction failed:', e3.message);
          }
        }
      }
    }
    
    if (summary) {
      console.log('✅ Final summary object keys:', Object.keys(summary));
      // Merge local metrics with GPT analysis
      summary.message_count = { you: messageCountYou, them: messageCountThem };
      summary.avg_message_length = { you: avgLengthYou, them: avgLengthThem };
      summary.top_words_you = topWordsYou;
      summary.top_words_them = topWordsThem;
    } else {
      console.error('❌ Failed to parse JSON from GPT response');
    }
    
    res.json({ success: true, summary, raw: response.data });

  } catch (err) {
    console.error('❌ Analyze Error:', err.message);
    if (err.response?.data) {
      console.error('🔍 OpenAI Response:', err.response.data);
    }
    res.status(500).json({ success: false, error: err.message, details: err.response?.data || null });
  }
});

app.listen(3000, () => {
  console.log('🚀 Server running on http://localhost:3000');
});
