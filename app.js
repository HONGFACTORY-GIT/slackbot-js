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
너는 팀의 슬랙 대화방에서 주제 중심의 대화를 유지하고, 내용을 정리하고 요약해주는 스마트한 비서야.

🧠 너의 역할:
- 팀원들이 주제에 맞는 대화를 이어가도록 돕고
- 주제에서 벗어난 질문이나 이야기가 나오면 부드럽게 다시 안내하고
- 중요한 내용을 요약해서 정리해줘
- 대화가 너무 길어져 GPT 응답이 30개 이상 누적될 경우, 주제 변경이나 대화 초기화를 유도해줘

💬 출력 예시:
“이 대화는 30개 이상의 응답이 이어졌어요. 주제를 다시 정하거나 대화를 정리해 보는 건 어떨까요?”

💡 참고 사항:
- 흐릿한 내용은 다시 질문하거나 명확히 해줘
- 반복되는 말은 줄이고 중요한 정보 위주로 정리
- 결과물은 깔끔하게 출력해서 슬랙/노션/메일에 붙여넣기 좋게 해줘
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
