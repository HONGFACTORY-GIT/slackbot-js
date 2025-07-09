const { App } = require("@slack/bolt");
require('dotenv').config();
const express = require('express');

// ✅ Slack App (Socket Mode로 실행)
const slackApp = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN, // SocketMode 사용 시 필요
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true
});

// ✅ Slack 이벤트
slackApp.event('app_home_opened', async ({ event, client }) => {
  try {
    await client.views.publish({
      user_id: event.user,
      view: {
        type: 'home',
        callback_id: 'home_view',
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "*Welcome to your _App's Home_* :tada:"
            }
          },
          { type: "divider" },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "이 버튼은 지금은 동작하지 않지만, 나중에 actions()로 핸들링 할 수 있어요!"
            }
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "Click me!"
                }
              }
            ]
          }
        ]
      }
    });
  } catch (error) {
    console.error(error);
  }
});

// ✅ 메시지 응답
slackApp.message('Hello', async ({ message, say }) => {
  await say(`Hello, <@${message.user}>`);
});

// ✅ Express 서버 (Cloudtype 헬스체크 및 접속용)
const server = express();
const PORT = process.env.PORT || 3000;

server.get('/', (_, res) => {
  res.send("✅ Slack bot is alive and ready!");
});

server.listen(PORT, async () => {
  console.log(`🌐 Express server is listening on port ${PORT}`);
  await slackApp.start();  // ⚠️ 여기서는 포트 넘기지 않음
  console.log('⚡️ Bolt app is running!');
});
