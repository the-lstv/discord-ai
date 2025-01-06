const
    argv = require('minimist')(process.argv.slice(2)),
    { GetGeneralBotConfig, BotClient, Personality, AbstractModel } = require(".")
;



// 1) Load the configuration file
const config = new GetGeneralBotConfig(`./config`);


// 2) Get the default model from the configuration file
const defaultModelName = config.data.block("use").attributes[0];
const defaultPersonalityName = argv.p || argv.personality || "default";


// 3) Load the personality
const defaultPersonality = new Personality(defaultPersonalityName);

if(!defaultPersonality.exists){
    console.error(`Personality file "${defaultPersonalityName}" not found`);
    process.exit(1);
}


// 4) Get the model
const defaultModel = config.getModel(defaultModelName);

if(!defaultModel){
    console.error(`Model template "${defaultModelName}" was not found`);
    process.exit(1);
}



// And finally:


// Create and start a new bot instance with the chosen personality and model
const modelWrapper = new AbstractModel(defaultModel, defaultPersonality);

// Create the bot client and attach the model
const client = new BotClient(modelWrapper, config);

// Start the bot
client.start();





// Handle uncaught errors without crashing the process
process.on('unhandledRejection', (reason, p) => {
    console.error(reason, 'Unhandled Rejection at Promise', p);
})

process.on('uncaughtException', err => {
    console.error(err, 'Uncaught Exception thrown');
});