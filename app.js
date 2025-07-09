const { App } = require("@slack/bolt");
const OpenAI = require("openai");
const express = require("express");
require("dotenv").config();

// ✅ 환경변수 체크
["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN", "SLACK_SIGNING_SECRET", "OPENAI_API_KEY"].forEach((key) => {
  if (!process.env[key]) {
    console.error(`❌ 환경 변수 ${key}가 설정되지 않았습니다.`);
    process.exit(1);
  }
});

// ✅ Slack App 초기화 (Socket Mode)
const slackApp = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
});

// ✅ OpenAI v4 SDK 초기화
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ✅ Slack 메시지 핸들링
slackApp.message(async ({ message, say }) => {
  if (message.subtype === "bot_message") return;

  const userInput = message.text?.trim();
  if (!userInput) {
    console.warn("⚠️ 사용자 메시지가 비어 있습니다.");
    await say("⚠️ 메시지가 비어있어요. 다시 입력해 주세요.");
    return;
  }

  console.log("[GPT 요청] 사용자 메시지:", userInput);

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo", // 또는 "gpt-4"
      messages: [
        { role: "system", content: "당신은 친절하고 유용한 슬랙 비서입니다." },
        { role: "user", content: userInput },
      ],
    });

    const reply = completion.choices[0]?.message?.content?.trim();
    if (!reply) {
      console.warn("⚠️ GPT 응답이 비어 있습니다.");
      await say("⚠️ GPT가 응답을 생성하지 못했어요.");
    } else {
      await say(reply);
    }
  } catch (err) {
    console.error("❌ GPT 응답 오류:", err);
    await say("⚠️ GPT 응답 중 오류가 발생했습니다.");
  }
});

// ✅ Express 서버 (헬스체크용)
const server = express();
const PORT = process.env.PORT || 3000;

server.get("/", (_, res) => {
  res.send("✅ Slack bot is alive and connected!");
});

server.listen(PORT, async () => {
  console.log(`🌐 Express server is listening on port ${PORT}`);
  await slackApp.start();
  console.log("⚡️ Bolt app is running!");
});
