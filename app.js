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

// ✅ OpenAI 초기화
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ✅ 개선된 GPT 시스템 프롬프트
const systemPrompt = `
당신은 슬랙에서 팀을 돕는 스마트한 대화 비서 GPT입니다."
`.trim();

// ✅ 채널별 대화 저장소
const conversations = new Map();
const MAX_MESSAGES = 60; // (30쌍)

// ✅ 봇 ID 변수
let botUserId = null;

// ✅ 봇 사용자 ID 가져오기
(async () => {
  const auth = await slackApp.client.auth.test({ token: process.env.SLACK_BOT_TOKEN });
  botUserId = auth.user_id;
  console.log(`🤖 Slack Bot ID: ${botUserId}`);
})();

// ✅ 슬랙 메시지 핸들링
slackApp.message(async ({ message, say }) => {
  if (message.subtype === "bot_message") return;
  const userInput = message.text?.trim();
  const channelId = message.channel;

  // ✅ GPT 호출 조건: @봇ID 태그 포함 여부 확인
  if (!userInput || !userInput.includes(`<@${botUserId}>`)) return;

  // ✅ 입력에서 봇 태그 제거
  const cleanInput = userInput.replace(`<@${botUserId}>`, "").trim();
  if (!cleanInput) {
    await say("⚠️ GPT에게 보낼 메시지를 입력해 주세요.");
    return;
  }

 console.log(`🟡 [요청] 채널: ${channelId},  입력: ${cleanInput}`);
  
  // ✅ 대화 이력 초기화
  if (!conversations.has(channelId)) {
    conversations.set(channelId, [{ role: "system", content: systemPrompt }]);
  }

  const history = conversations.get(channelId);
  history.push({ role: "user", content: cleanInput });

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: history,
    });

    const reply = completion.choices[0]?.message?.content?.trim();
    if (!reply) {
      await say("⚠️ GPT가 응답을 생성하지 못했어요.");
    } else {
      history.push({ role: "assistant", content: reply });
      await say(reply);
    }

    // ✅ 응답 개수 경고
    if (history.length >= MAX_MESSAGES) {
      await say("⚠️ 이 대화는 GPT 응답이 30개 이상 이어졌어요. 주제를 다시 정하거나 `/reset`으로 초기화해보는 건 어떨까요?");
    }

  } catch (err) {
    console.error("❌ GPT 응답 오류:", err);
    await say("⚠️ GPT 응답 중 오류가 발생했습니다.");
  }
});

// ✅ 헬스 체크용 Express 서버
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
