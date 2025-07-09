const { App } = require("@slack/bolt");
const { Configuration, OpenAIApi } = require("openai");
require('dotenv').config();

const slackApp = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true
});

// ✅ OpenAI 설정
const openai = new OpenAIApi(
  new Configuration({
    apiKey: process.env.OPENAI_API_KEY
  })
);

// ✅ Slack 메시지 이벤트 핸들링
slackApp.message(async ({ message, say }) => {
  if (message.subtype && message.subtype === 'bot_message') return;

  try {
    console.log("[GPT 요청] 사용자 메시지:", message.text);

    const completion = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",  // 또는 gpt-4
      messages: [
        { role: "system", content: "당신은 친절한 슬랙 비서입니다." },
        { role: "user", content: message.text }
      ]
    });

    const reply = completion.data.choices[0].message.content.trim();

    await say(reply);
  } catch (err) {
    console.error("GPT 처리 오류:", err);
    await say("⚠️ GPT 응답 중 오류가 발생했습니다.");
  }
});

// ✅ Express 헬스 체크용 서버
const express = require('express');
const server = express();
const PORT = process.env.PORT || 3000;

server.get('/', (_, res) => res.send('✅ Slack bot is alive!'));

server.listen(PORT, async () => {
  console.log(`🌐 Express server is listening on port ${PORT}`);
  await slackApp.start();
  console.log("⚡️ Bolt app is running!");
});
