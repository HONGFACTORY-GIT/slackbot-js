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

const conversations = new Map();
const MAX_HISTORY = 60;
let botUserId = null;

// ✅ Slack 봇 유저 ID 확인
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

  // ✅ 대화 이력 불러오기
  const prevHistory = conversations.get(channelId) || [];
  const trimmedHistory = prevHistory.slice(-MAX_HISTORY);

  // ✅ 반복 질문 감지
  const lastUserMsg = trimmedHistory.slice().reverse().find(msg => msg.role === "user")?.content || "";
  const isRepeatedQuestion = lastUserMsg && rawInput === lastUserMsg;

  let repetitionNotice = "";
  if (isRepeatedQuestion) {
    repetitionNotice = `💡 이전에도 비슷한 질문을 하셨는데, 이번엔 다른 관점에서 설명해드릴게요.\n`;
  }

  // ✅ 랜덤 응답 구조 스타일
  const responseStructures = [
    "현상 → 원인 → 해결 → 요약",
    "문제 → 해결 → 결과",
    "TIP 3가지",
    "Q&A 형식",
    "실제 사례 → 교훈 → 적용법",
    "스토리텔링 → 분석 → 제안",
    "원리 설명 → 활용 방법",
    "비유 중심 해설",
    "장단점 비교"
  ];
  const selectedStructure = responseStructures[Math.floor(Math.random() * responseStructures.length)];

  // ✅ systemPrompt 생성
  const systemPrompt = `
당신은 슬랙 채널에서 팀의 질문을 돕는 스마트한 대화형 GPT입니다.

🎯 목적:
- 사용자의 질문에 대해 분석하고, 깊이 있게 생각을 확장하며, 실용적인 해결 방안을 제시하는 것이 목표입니다.
- 단순한 정보 나열이 아니라, 상대가 쉽게 이해하고 바로 적용할 수 있도록 설명하세요.

🎲 이번 응답의 구조 스타일:
- 이번 답변은 "${selectedStructure}" 구조를 참고해 작성해 주세요.
- 단, 질문에 따라 더 자연스럽고 효과적인 흐름이 있다면 자유롭게 조정해도 됩니다.
- 동일한 구조와 말투를 반복하지 마세요.

📌 응답 가이드라인:
- 질문의 맥락을 파악하고, 상황에 따라 응답 형식을 조정하세요.
- 길이는 제한하지 않으며, 예시와 설명을 풍부하게 포함해 주세요.
- 실제 사례나 비유, 업무 적용 예시는 필수입니다.
- 마무리에는 다음 행동이나 선택지를 제안해 주세요.
`.trim();

  const chatHistory = [
    { role: "system", content: systemPrompt },
    ...trimmedHistory,
    { role: "user", content: repetitionNotice + cleanInput }
  ];

  console.log(`🟡 [입력] 채널: ${channelId}, 입력: ${rawInput}`);

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
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
