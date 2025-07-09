const { App } = require("@slack/bolt");
require('dotenv').config();
const express = require('express'); // ✅ 추가

// Slack Bolt 앱 초기화
const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET
});

// Slack 이벤트 핸들러
app.event('app_home_opened', async ({ event, client }) => {
    try {
        await client.views.publish({
            user_id: event.user,
            view: {
                type: 'home',
                callback_id: 'home_view',
                blocks: [
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": "*Welcome to your _App's Home_* :tada:"
                        }
                    },
                    { "type": "divider" },
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": "This button won't do much for now but you can set up a listener for it using the `actions()` method."
                        }
                    },
                    {
                        "type": "actions",
                        "elements": [
                            {
                                "type": "button",
                                "text": {
                                    "type": "plain_text",
                                    "text": "Click me!"
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

app.message('Hello', async ({ message, say }) => {
    await say(`Hello, <@${message.user}>`);
});

// Slack App 시작
(async () => {
    await app.start(process.env.PORT || 3000);
    console.log('⚡️ Bolt app is running!');
})();

// ✅ 외부 포트용 Express 서버 추가 (Cloudtype 용)
const server = express();
const PORT = process.env.PORT || 3000;

server.get('/', (req, res) => {
    res.send('✅ Slack bot is running and listening!');
});

server.listen(PORT, () => {
    console.log(`🌐 Express server is listening on port ${PORT}`);
});
