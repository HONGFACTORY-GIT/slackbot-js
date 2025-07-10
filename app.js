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
  const text = message.text?.trim();
  if (!text || !botUserId) return;

  const isMentioned = text.includes(`<@${botUserId}>`);
  const rawInput = text.replace(`<@${botUserId}>`, "").trim();
  const prevHistory = conversations.get(channelId) || [];

  // ✅ GPT 호출 여부와 관계없이 모든 사용자 메시지 저장
  if (message.user && !message.subtype) {
    const userMessage = rawInput || text;
    const updatedHistory = [...prevHistory, { role: "user", content: userMessage }];
    conversations.set(channelId, updatedHistory);
  }

  // ✅ GPT를 호출하지 않았다면 응답하지 않음
  if (!isMentioned) return;

  // ✅ 자연어 기반 요약 명령어 감지
  const isSummaryRequest = /(대화.?내용|말한.?내용|얘기.*내용).*요약.*(줘|해)/.test(rawInput);
  if (isSummaryRequest) {
    const userOnlyMessages = (conversations.get(channelId) || [])
      .filter(msg => msg.role === "user")
      .map((msg, i) => `(${i + 1}) ${msg.content}`)
      .join("\n");

    if (!userOnlyMessages) {
      await say("📭 요약할 사용자 메시지가 없습니다.");
      return;
    }

    const summaryPrompt = `
다음은 사용자의 Slack 대화입니다. 어떤 주제들이 오갔는지, 어떤 흐름으로 대화가 전개되었는지 요약해 주세요.

${userOnlyMessages}
    `.trim();

    try {
      const summaryCompletion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "당신은 Slack 대화를 요약하는 GPT입니다." },
          { role: "user", content: summaryPrompt }
        ],
        max_tokens: 1024,
        temperature: 0.5
      });

      const summary = summaryCompletion.choices[0]?.message?.content?.trim();

      if (summary) {
        await say(`📝 사용자 대화 요약:\n${summary}`);
      } else {
        await say("⚠️ 대화 요약을 생성하지 못했어요.");
      }
    } catch (err) {
      console.error("❌ 요약 오류:", err);
      await say("⚠️ 대화 요약 중 오류가 발생했습니다.");
    }

    return;
  }

  // ✅ /reset 명령어 처리
  if (rawInput === "/reset") {
    conversations.set(channelId, []);
    await say("🧹 대화를 초기화했어요. 새 주제로 다시 시작해볼까요?");
    return;
  }

  // ✅ 짧은 질문 처리
  const cleanInput = rawInput.length < 15
    ? `질문이 다소 짧습니다. 맥락을 고려해 자세히 답해주세요: "${rawInput}"`
    : rawInput;

  const trimmedHistory = prevHistory.slice(-MAX_HISTORY);
  const lastUserMsg = trimmedHistory.slice().reverse().find(msg => msg.role === "user")?.content || "";
  const isRepeated = lastUserMsg && rawInput === lastUserMsg;

  let repetitionNotice = "";
  if (isRepeated) {
    repetitionNotice = "💡 같은 질문이 반복되었어요. 이번엔 다르게 설명해볼게요.\n";
  }

  // ✅ system 프롬프트 구성
  const systemPrompt = `
당신은 Slack 팀 채널에서 질문을 도와주는 스마트한 GPT입니다.

🎯 목적:
- 사용자의 질문에 대해 맥락을 파악하고 깊이 있는 실용적 답변을 제공합니다.

📌 스타일:
- 질문 성격에 따라 설명 구조를 스스로 선택하세요.
- 예시, 비유, 적용 팁을 포함하세요.
- 갑작스러운 주제 변경 시 흐름을 리마인드해 주세요.
`.trim();

  const chatHistory = [
    { role: "system", content: systemPrompt },
    ...trimmedHistory,
    { role: "user", content: repetitionNotice + cleanInput }
  ];

  // ✅ GPT 응답 생성
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: chatHistory,
      max_tokens: 2048,
      temperature: 0.7,
    });

    const reply = completion.choices[0]?.message?.content?.trim();

    if (!reply) {
      await say("⚠️ GPT가 응답을 생성하지 못했어요.");
      return;
    }

    const updatedHistory = [
      ...trimmedHistory,
      { role: "user", content: cleanInput },
      { role: "assistant", content: reply }
    ];
    conversations.set(channelId, updatedHistory);

    await say(reply);

    if (updatedHistory.length >= MAX_HISTORY) {
      await say("⚠️ 대화가 길어졌어요. `/reset`으로 초기화하는 걸 추천합니다.");
    }
  } catch (err) {
    console.error("❌ GPT 응답 오류:", err);
    await say("⚠️ GPT 응답 중 오류가 발생했습니다.");
  }
});

// ✅ Express 서버 (헬스체크)
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
