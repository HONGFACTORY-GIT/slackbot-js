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
당신은 슬랙 채널에서 팀의 질문을 돕는 대화형 GPT입니다.

🎯 역할:
- 질문의 의도와 맥락을 파악하고, 유사하지만 뉘앙스가 다른 질문에도 다르게 응답하세요.
- 같은 질문이라도 다양한 관점(비유, 사례, 논리, 반론 등)에서 설명할 수 있도록 유도하세요.
- 매 응답에서는 새로운 통찰 또는 연결점을 하나 이상 추가해 주세요.
- 이전 대화 내용을 기반으로 연결하거나, 질문자의 습관에 맞는 스타일로 답변을 조정하세요.
- 응답의 문체나 어투, 전달 방식(목차형, 스토리텔링, Q&A 등)을 가끔씩 변화시켜 사용자 피로도를 줄이세요.

🎨 응답 스타일:
- 단순한 정보 나열 대신 대화식 흐름으로 전개합니다.
- 예시와 비유를 자율적으로 포함하며, 정답보다 ‘이해’를 우선합니다.
- 마무리에는 질문을 유도하거나, 다음 단계 선택지를 제안합니다.
`.trim();

const conversations = new Map();
const MAX_HISTORY = 60; // 메시지 이력 제한

let botUserId = null;

(async () => {
  const auth = await slackApp.client.auth.test({ token: process.env.SLACK_BOT_TOKEN });
  botUserId = auth.user_id;
  console.log(`🤖 Slack Bot ID: ${botUserId}`);
})();

// ✅ Slack 메시지 처리
slackApp.message(async ({ message, say }) => {
  if (message.subtype === "bot_message") return;

  const channelId = message.channel;
  const userInput = message.text?.trim();
  if (!userInput || !userInput.includes(`<@${botUserId}>`)) return;

  const rawInput = userInput.replace(`<@${botUserId}>`, "").trim();
  if (!rawInput) {
    await say("⚠️ GPT에게 보낼 메시지를 입력해 주세요.");
    return;
  }

  // ✅ /reset 명령어 처리
  if (rawInput === "/reset") {
    conversations.set(channelId, []);
    await say("🧹 대화를 초기화했어요. 새 주제로 다시 시작해볼까요?");
    return;
  }

  // ✅ 짧은 질문 보완용 프롬프트 래핑
  const cleanInput = rawInput.length < 15
    ? `질문이 다소 짧습니다. 이 질문에 대해 맥락을 고려한 충분한 길이의 답변을 해주세요: "${rawInput}"`
    : rawInput;

  // ✅ 기존 이력 불러오기
  const prevHistory = conversations.get(channelId) || [];
  const trimmedHistory = prevHistory.slice(-MAX_HISTORY);
  const chatHistory = [
    { role: "system", content: systemPrompt },
    ...trimmedHistory,
    { role: "user", content: cleanInput }
  ];

  console.log(`🟡 [입력] 채널: ${channelId}, 입력: ${rawInput}`);

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o", // gpt-4o도 가능하지만, 길이 안정성은 preview 모델이 좋음
      messages: chatHistory,
      max_tokens: 2048,
      temperature: 0.7,
      top_p: 1.0,
      frequency_penalty: 0.2,
      presence_penalty: 0.3,
    });

    const reply = completion.choices[0]?.message?.content?.trim();

    if (!reply) {
      await say("⚠️ GPT가 응답을 생성하지 못했어요.");
      return;
    }

    const newHistory = [
      ...trimmedHistory,
      { role: "user", content: cleanInput },
      { role: "assistant", content: reply }
    ];
    conversations.set(channelId, newHistory);

    await say(reply);

    // ✅ 누적 경고 출력
    if (newHistory.length >= MAX_HISTORY) {
      await say("⚠️ 이 대화는 GPT 응답이 30개 이상 이어졌어요. 주제를 다시 정하거나 `/reset`으로 초기화해보는 건 어떨까요?");
    }

  } catch (err) {
    console.error("❌ GPT 응답 오류:", err);
    await say("⚠️ GPT 응답 중 오류가 발생했습니다.");
  }
});

// ✅ Express 서버 (헬스 체크용)
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
