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

// ✅ Slack App 초기화
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

// ✅ 시스템 프롬프트
const systemPrompt = `
당신은 슬랙에서 팀을 돕는 스마트한 대화 비서 GPT입니다.

🧠 역할:
- 현재 대화의 주제를 파악하고 유지하며 흐름을 관리합니다.
- 사용자가 주제에서 벗어난 질문을 하면 부드럽게 안내합니다.
- 이전 주제와 다른 질문이 시작되면 해당 주제를 진행하는게 맞는지 물어봅니다.
- 간결하되 충분한 길이로 응답을 구성해 주세요. 짧은 응답은 지양합니다.
- 응답이 30개 이상 누적되면 주제 전환이나 초기화를 유도합니다.
- 반복되는 질문은 "이전에 언급했지만..." 형태로 처리합니다.

💬 응답 형식:
- 대화 흐름을 고려한 자연스러운 문장
- 정보 전달 후 다음 질문을 유도하거나 정리 제안

📌 예외 처리:
👉 "이 대화는 30개 이상의 응답이 이어졌어요. 주제를 다시 정하거나 \`/reset\`으로 초기화해보는 건 어떨까요?"
`.trim();

// ✅ 대화 저장소
const conversations = new Map();
const MAX_HISTORY = 60; // 최대 메시지 개수 (user/assistant 합쳐서)

// ✅ 봇 ID 저장
let botUserId = null;

(async () => {
  const auth = await slackApp.client.auth.test({ token: process.env.SLACK_BOT_TOKEN });
  botUserId = auth.user_id;
  console.log(`🤖 Slack Bot ID: ${botUserId}`);
})();

// ✅ Slack 메시지 핸들링
slackApp.message(async ({ message, say }) => {
  if (message.subtype === "bot_message") return;

  const channelId = message.channel;
  const userInput = message.text?.trim();
  if (!userInput || !userInput.includes(`<@${botUserId}>`)) return;

  const cleanInput = userInput.replace(`<@${botUserId}>`, "").trim();

  if (!cleanInput) {
    await say("⚠️ GPT에게 보낼 메시지를 입력해 주세요.");
    return;
  }

  // ✅ /reset 처리
  if (cleanInput === "/reset") {
    conversations.set(channelId, []);
    await say("🧹 대화를 초기화했어요. 새 주제로 다시 시작해볼까요?");
    return;
  }

  // ✅ 기존 이력 불러오기 (없으면 빈 배열)
  const prevHistory = conversations.get(channelId) || [];

  // ✅ 대화 이력: 최근 MAX 유지 + systemPrompt 항상 삽입
  const trimmedHistory = prevHistory.slice(-MAX_HISTORY);
  const chatHistory = [
    { role: "system", content: systemPrompt },
    ...trimmedHistory,
    { role: "user", content: cleanInput }
  ];

  console.log(`🟡 [요청] 채널: ${channelId}, 입력: ${cleanInput}`);

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: chatHistory,
      max_tokens: 1024,
      temperature: 0.7,
      top_p: 1.0,
      frequency_penalty: 0.3,
      presence_penalty: 0.4,
    });

    const reply = completion.choices[0]?.message?.content?.trim();

    if (!reply) {
      await say("⚠️ GPT가 응답을 생성하지 못했어요.");
      return;
    }

    // ✅ 응답 저장 및 출력
    const newHistory = [...trimmedHistory, { role: "user", content: cleanInput }, { role: "assistant", content: reply }];
    conversations.set(channelId, newHistory);
    await say(reply);

    // ✅ 응답 30쌍 초과 시 안내
    if (newHistory.length >= MAX_HISTORY) {
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
