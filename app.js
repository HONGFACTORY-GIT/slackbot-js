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

  // ✅ "대화내용요약" 명령어 처리
  if (rawInput === "대화내용요약") {
    const prevHistory = conversations.get(channelId) || [];

    const userOnlyMessages = prevHistory
      .filter(msg => msg.role === "user")
      .map((msg, i) => `(${i + 1}) ${msg.content}`)
      .join("\n");

    if (!userOnlyMessages) {
      await say("📭 요약할 사용자 메시지가 없습니다.");
      return;
    }

    const summaryPrompt = `
다음은 사용자의 과거 Slack 대화 메시지입니다.
이 흐름을 보고 어떤 주제를 이야기했는지 간결하게 요약해 주세요.
너무 단순 요약보다는, 흐름이 어떤 식으로 전개되었는지도 설명해 주세요:

${userOnlyMessages}
    `.trim();

    try {
      const summaryCompletion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "당신은 Slack 대화 흐름을 정리해주는 똑똑한 요약 비서입니다." },
          { role: "user", content: summaryPrompt }
        ],
        max_tokens: 1024,
        temperature: 0.5
      });

      const summary = summaryCompletion.choices[0]?.message?.content?.trim();

      if (summary) {
        await say(`📝 사용자 대화 흐름 요약:\n${summary}`);
      } else {
        await say("⚠️ 대화 요약이 생성되지 않았습니다.");
      }
    } catch (err) {
      console.error("❌ 요약 중 오류:", err);
      await say("⚠️ 대화 요약 중 오류가 발생했습니다.");
    }

    return;
  }

  // ✅ 짧은 질문 보완용 프롬프트 래핑
  const cleanInput = rawInput.length < 15
    ? `질문이 다소 짧습니다. 이 질문에 대해 맥락을 고려한 충분한 길이의 답변을 해주세요: "${rawInput}"`
    : rawInput;

  const prevHistory = conversations.get(channelId) || [];
  const trimmedHistory = prevHistory.slice(-MAX_HISTORY);

  // ✅ 반복 질문 감지
  const lastUserMsg = trimmedHistory.slice().reverse().find(msg => msg.role === "user")?.content || "";
  const isRepeatedQuestion = lastUserMsg && rawInput === lastUserMsg;

  let repetitionNotice = "";
  if (isRepeatedQuestion) {
    repetitionNotice = `💡 이전에도 비슷한 질문을 하셨는데, 이번엔 다른 관점에서 설명해드릴게요.\n`;
  }

  // ✅ systemPrompt 설정
  const systemPrompt = `
당신은 슬랙 채널에서 팀의 질문을 돕는 스마트한 대화형 GPT입니다.

🎯 목적:
- 사용자의 질문에 대해 분석하고, 깊이 있게 생각을 확장하며, 실용적인 해결 방안을 제시하는 것이 목표입니다.
- 단순한 정보 나열이 아니라, 상대가 쉽게 이해하고 바로 적용할 수 있도록 설명하세요.

🎲 응답 구조 스타일:
- 질문의 성격에 따라 가장 자연스럽고 효과적인 구조를 **GPT가 직접 선택해 주세요.**
- 다음은 참고 가능한 응답 구조입니다 (필요에 따라 조합 가능):

  • 현상 → 원인 → 해결 → 요약  
  • 문제 → 해결 → 결과  
  • 실제 사례 → 교훈 → 적용법  
  • 스토리텔링 → 분석 → 제안  
  • Q&A 형식  
  • 비유 중심 해설  
  • 장점 → 단점 → 추천 기준  
  • 오해 → 진실 → 활용법  
  • Before → After → 변화 방법  
  • 현재 상태 → 목표 → 중간 단계 제시  
  • 상황 → 공감 → 제안  
  • 의문 제기 → 분석 → 재정의  
  • 사례 → 패턴 → 전략  
  • 과정 → 문제 → 개선안  
  • 원리 설명 → 활용 방법

📌 응답 가이드라인:
- 질문의 맥락을 파악하고, 상황에 따라 응답 형식을 조정하세요.
- 예시와 설명을 풍부하게 포함해 주세요.
- 마무리에는 다음 행동이나 선택지를 제안해 주세요.

🔴 주제 일관성 유지:
- 대화 중 주제가 명확히 진행되고 있을 경우, 질문이 갑자기 다른 방향으로 전환되면 그 점을 부드럽게 지적하고, 관련된 질문인지 확인해 주세요.
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
