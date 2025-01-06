This project allows you to create unique realistic Discord personalities using various AI models. <br>
They can engage in conversations, add flair to your server, help with moderation, and more.

## How to run:

1) Clone the repo with `git clone --recurse-submodules https://github.com/the-lstv/discord-ai.git`
    - Make sure you have all the required dependencies installed:
    `npm i openai @google/generative-ai discord.js minimist sharp atrium-parser` + discord.js-selfbot-v13 (if using selfbots)
2) Head over to the /config file and make sure the model/platform you want to use is setup correctly
    - Also make sure that you have the correct API key environment variables set up.
3) Create or configure your personality (along with a Discord bot or account token and application ID) in /personalities/
    - Refer to "template" for a sample of a personality configuration
4) Run `node bot -p <personality>` to start the bot with the specified personality.

## Debugging:
You can use the bot's admin-only commands for debugging (you can configure admin accounts in the config).<br>
However, for regular user accounts or environments where bot commands arent available, you can attach a debugger.

## For developers:
Head out to `bot.js` for the basic interactive code example. <br>
If you want to check out how the bot works or make core changes, check out the main module in `index.js`.