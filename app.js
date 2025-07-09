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

  // ✅ 랜덤 응답 스타일 설정
  const responseStyles = [
    "Q&A 형식", "스토리텔링 형식", "비유 중심 설명",
    "사례 기반 설명", "반문 형식", "목차 없이 대화체 흐름"
  ];
  const randomStyle = responseStyles[Math.floor(Math.random() * responseStyles.length)];

  const systemPrompt = `
당신은 슬랙 채널에서 팀의 질문을 돕는 스마트한 대화형 GPT입니다.

📌 응답의 목표:
- 질문에 대해 단순한 정보 전달이 아니라, 문제를 분석하고 실질적인 해결책을 제시하는 것입니다.
- 특히 사용자가 겪고 있는 상황이나 혼란을 파악하고, 그 원인을 분석한 뒤 실천 가능한 해결방안을 제시하는 데 집중하세요.

🧠 응답 구조 지침:
질문에 대한 응답은 다음 네 가지 단계로 구성하세요:

1️⃣ **현상 진단**  
- 지금 어떤 문제가 발생하고 있는지, 또는 사용자가 느끼는 현상을 먼저 설명하세요.  
- 질문의 배경이나 겉으로 드러난 증상부터 명확히 정의합니다.

2️⃣ **원인 분석**  
- 해당 현상이 왜 발생하는지 근본적인 원인을 1~2가지로 분석하세요.  
- 심리적, 기술적, 구조적 원인을 조합해 제시할 수 있습니다.

3️⃣ **해결 방안 제시**  
- 단계별로 실행 가능한 구체적인 해결책을 제안하세요.  
- 기술적인 예시, 업무 시나리오, 실생활 비교 등을 포함하세요.

4️⃣ **요약 및 실천 지침**  
- 위 내용을 핵심 문장으로 정리하고, 사용자가 지금 당장 무엇을 실천하면 좋을지 제안하세요.  
- 다음 행동을 유도하는 문장을 끝에 넣어주세요.

🎨 스타일 지침:
- 응답은 대화체가 아니라 분석 리포트처럼 구성하되, 너무 딱딱하지 않게 설명해 주세요.
- 예시는 반드시 하나 이상 포함해야 하며, 구체적일수록 좋습니다.
- 응답 길이는 상황에 따라 자유롭게 확장하되, 핵심 구조는 유지하세요.
- 반복된 질문일 경우 "다른 관점에서 다시 분석해보겠습니다"와 같은 표현으로 변화를 주세요.

💬 예시 스타일:
- “많은 사람들이 이런 상황을 겪습니다. 주된 원인은 ○○이며, 이를 해결하려면 △△ 단계를 거치는 것이 효과적입니다. 우선 1단계부터 실천해보세요.”

이 지침을 기반으로, 질문자에게 가장 도움이 되는 응답을 생성해 주세요.
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
