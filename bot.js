const argv = require('minimist')(process.argv.slice(2));
const { GetGeneralBotConfig, BotClient, Personality, AbstractModel } = require(".");





// 1) Load the personality
const personality_name = argv.p || argv.personality || "default";
const personality = new Personality(personality_name);

if(!personality.exists){
    console.error(`Personality file "${personality_name}" not found`);
    process.exit(1);
}


// 2) Load the configuration file
const config = new GetGeneralBotConfig(`./config`);


// 3) Get the model reference/config
const model_name = config.data.block("use").attributes[0];
const model_reference = config.getModel(model_name);

if(!model_reference){
    console.error(`Model template "${model_name}" was not found in the config`);
    process.exit(1);
}





// And finally, we can use the personality and model to run a bot.

// Create the model instance
const model = new AbstractModel(model_reference, personality);

// Create the bot client and attach the model
const client = new BotClient(model, config);

// Start the bot
client.start();





// Handle uncaught errors without crashing the process
process.on('unhandledRejection', (reason, p) => {
    console.error(reason, 'Unhandled Rejection at Promise', p);
})

process.on('uncaughtException', err => {
    console.error(err, 'Uncaught Exception thrown');
});