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

// ✅ GPT 시스템 프롬프트
const systemPrompt = `
너는 슬랙 채널에서 동작하는 팀 어시스턴트 GPT야.

🧠 역할:
- 대화의 주제를 파악하고 유지하며
- 사용자의 질문이 주제에서 벗어날 경우 부드럽게 안내하고
- 중요 정보만 간결하게 요약 정리해
- 응답 횟수가 30개 이상일 땐 주제 변경을 유도해
- 반복되는 내용은 생략하고 새로운 인사이트 중심으로 안내해

🎯 지시사항:
- 항상 이전 대화의 주제를 인식하고, 해당 주제 안에서 답변할 것
- 사용자의 질문이 새로운 주제일 경우, "새로운 주제로 넘어갔어요!"라고 명시할 것
- 이전에 나온 답변과 중복되면 "이전에 언급했지만 추가로 말씀드리자면…" 식으로 이어갈 것
- 요약 시 `•` 기호를 써서 핵심 항목만 간결하게 정리
- 30개 이상 응답 누적 시 아래 문구 출력:
  👉 “이 대화는 30개 이상의 응답이 이어졌어요. 주제를 다시 정하거나 대화를 정리해 보는 건 어떨까요?”

`.trim();

// ✅ 채널별 대화 저장소
const conversations = new Map();
const MAX_MESSAGES = 60; // GPT 응답 30쌍 기준 (user + assistant)

slackApp.message(async ({ message, say }) => {
  if (message.subtype === "bot_message") return;
  const channelId = message.channel;
  const userInput = message.text?.trim();
  if (!userInput) {
    await say("⚠️ 메시지가 비어있어요. 다시 입력해 주세요.");
    return;
  }

  // ✅ 채널별 메시지 초기화
  if (!conversations.has(channelId)) {
    conversations.set(channelId, [{ role: "system", content: systemPrompt }]);
  }

  const history = conversations.get(channelId);
  history.push({ role: "user", content: userInput });

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: history,
    });

    const reply = completion.choices[0]?.message?.content?.trim();
    if (!reply) {
      console.warn("⚠️ GPT 응답이 비어 있습니다.");
      await say("⚠️ GPT가 응답을 생성하지 못했어요.");
    } else {
      history.push({ role: "assistant", content: reply });
      await say(reply);
    }

    // ✅ 응답 누적 30쌍(60개 메시지) 초과 시 경고
    if (history.length >= MAX_MESSAGES) {
      await say("⚠️ 이 대화는 GPT 응답이 30개 이상 이어졌어요. 주제를 다시 정하거나 `/reset`으로 대화를 초기화하는 걸 추천드려요.");
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
