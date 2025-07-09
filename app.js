const { App } = require("@slack/bolt");
const OpenAI = require("openai");
const express = require("express");
require("dotenv").config();

// ✅ 환경 변수 체크
["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN", "SLACK_SIGNING_SECRET", "OPENAI_API_KEY"].forEach((key) => {
  if (!process.env[key]) {
    console.error(`❌ 환경 변수 ${key}가 설정되지 않았습니다.`);
    process.exit(1);
  }
});

// ✅ Slack 초기화
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

// ✅ 대화 비서용 시스템 프롬프트
const systemPrompt = `
당신은 슬랙에서 팀을 돕는 스마트한 대화형 GPT 비서입니다.

🧠 역할:
- 사용자의 질문을 파악하고 대화 흐름을 유지합니다.
- 문서형 설명 대신 **사람처럼 말하듯** 응답하세요.
- 각 항목에 **짧은 설명 + 예시**를 함께 넣어주세요.
- 응답의 끝에는 항상 **상호작용 질문이나 다음 행동 제안**을 포함하세요.
- 질문이 모호하거나 짧으면 의도를 유추하거나 되물어보세요.

💬 스타일 예시:
- "좋은 질문이에요. 함께 정리해볼까요?"
- "혹시 이런 방향이 맞을까요? 아니면 다른 접근을 원하시나요?"
`.trim();

const conversations = new Map();
const MAX_HISTORY = 60;
let botUserId = null;

(async () => {
  const auth = await slackApp.client.auth.test({ token: process.env.SLACK_BOT_TOKEN });
  botUserId = auth.user_id;
  console.log(`🤖 Slack Bot ID: ${botUserId}`);
})();

// ✅ 사용자 질문 가공
function enrichUserInput(input) {
  if (input.length < 15) {
    return `질문이 다소 짧습니다. 아래 질문에 대해 대화형 스타일로 예시와 함께 충분히 설명해 주세요:\n"${input}"`;
  }
  return input;
}

// ✅ 응답 후처리
function finalizeReply(replyText) {
  const suffix = `\n\n👉 혹시 이 중 어떤 단계부터 먼저 시작해보고 싶으신가요?`;
  return replyText.endsWith("?") ? replyText : replyText + suffix;
}

// ✅ Slack 메시지 핸들링
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

  if (rawInput === "/reset") {
    conversations.set(channelId, []);
    await say("🧹 대화를 초기화했어요. 새 주제로 다시 시작해볼까요?");
    return;
  }

  const enrichedInput = enrichUserInput(rawInput);
  const prevHistory = conversations.get(channelId) || [];
  const trimmedHistory = prevHistory.slice(-MAX_HISTORY);

  const chatHistory = [
    { role: "system", content: systemPrompt },
    ...trimmedHistory,
    { role: "user", content: enrichedInput }
  ];

  console.log(`🟡 [입력] 채널: ${channelId}, 입력: ${rawInput}`);

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: chatHistory,
      max_tokens: 2048,
      temperature: 0.7,
      top_p: 1.0,
      frequency_penalty: 0.3,
      presence_penalty: 0.3,
    });

    let reply = completion.choices[0]?.message?.content?.trim();
    if (!reply) {
      await say("⚠️ GPT가 응답을 생성하지 못했어요.");
      return;
    }

    reply = finalizeReply(reply);
    const newHistory = [...trimmedHistory, { role: "user", content: enrichedInput }, { role: "assistant", content: reply }];
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

// ✅ Express 헬스 체크
const server = express();
const PORT = process.env.PORT || 3000;

server.get("/", (_, res) => {
  res.send("✅ Slack GPT bot is running!");
});

server.listen(PORT, async () => {
  console.log(`🌐 Express server is listening on port ${PORT}`);
  await slackApp.start();
  console.log("⚡️ Slack Bolt app is live!");
});
