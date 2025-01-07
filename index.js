/*
    Author: Lukas (thelstv)
    Copyright: (c) https://lstv.space

    Last modified: 2024
    License: GPL-3.0
    Version: 1.0.0
    Description: A Node.js module allowing you to create Discord AI bots
    See: https://github.com/the-lstv/discord-ai
*/


// Enums
const Platforms = {
    OpenAI: 0,
    GoogleAI: 1,
    ArisenAI: 2,
    Anthropic: 3
}

// Requirements
let OpenAI,
    GoogleAI,
    ArisenAI,

    Discord,
    DiscordSelfBot,

    fs = require("fs"),
    sharp = require('sharp'),

    { parse, configTools } = require("./lib/parser"),
    start = performance.now()
;


/**
 * @description Manager for the general bot configuration
 */

class GetGeneralBotConfig {
    constructor(path){
        this.path = path;
        this.refresh()
    }
    
    refresh(){
        this.data = configTools( parse( fs.readFileSync(this.path, "utf8"), { asLookupTable: true } ) );
        this.models = [...this.data.blocks("model")];
    }

    getModel(name){
        return this.models.find(model => model.attributes[0] === name)
    }
}


/**
 * @description Abstract model class to wrap different AI platforms under the same interface
 */

class AbstractModel {
    constructor(model, personality, config = {}) {
        this.platform = {
            "OpenAI": Platforms.OpenAI,
            "GoogleAI": Platforms.GoogleAI,
            "ArisenAI": Platforms.ArisenAI,
            "Anthropic": Platforms.Anthropic
        }[model.get("platform", String)];

        switch(this.platform){
            case Platforms.OpenAI:
                if(!OpenAI) OpenAI = require("openai");
            break;

            case Platforms.GoogleAI:
                if(!GoogleAI) GoogleAI = require('@google/generative-ai');
            break;

            case Platforms.ArisenAI:
                if(!ArisenAI) ArisenAI = null; // internal support
            break;
        }

        this.config = model;
        this.personality = personality;

        this.instruction = fs.readFileSync(model.get("prompt", String), "utf8").replace("$PERSONALITY", personality.lore)

        switch(this.platform){
            case Platforms.OpenAI:
                this.engine = new OpenAI({
                    apiKey: process.env.OPENAI_API_KEY,
                });
            break;

            case Platforms.GoogleAI:
                this.engine = new GoogleAI.GoogleGenerativeAI(process.env.GEMINI_KEY);
            break;

            case Platforms.ArisenAI:
                this.engine = new ArisenAI.LLM("https://api.extragon.cloud/v2/arisen", process.env.ARISEN_KEY);
            break;

            default:
                throw new Error("Unsupported AI platform")
        }
    }

    async initModel(){
        switch(this.platform){
            case Platforms.GoogleAI:
                if(!this.instance) this.instance = await this.engine.getGenerativeModel({
                    model: this.config.get("model", String),
                    systemInstruction: this.instruction,
                    safetySettings: [
                        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
                    ]
                });
            break;
        }
    }

    async createThread(){
        const thread = new AbstractThread(this);
        await thread.init();
        return thread;
    }
}


/**
 * @description Abstract thread class
 */

class AbstractThread {
    constructor(model){
        this.model = model;
    }

    async init(){
        switch(this.model.platform){
            case Platforms.OpenAI:
                return this.instance = await this.model.engine.beta.threads.create();

            case Platforms.GoogleAI:
                return this.instance = await this.model.instance.startChat({
                    generationConfig: {
                        temperature: this.model.config.get("temperature", Number, 1.2),
                        // topP: 0.95,
                        // topK: 64,
                        // maxOutputTokens: 8192,
                        responseMimeType: "application/json",
                    },

                    history: []
                });

            case Platforms.ArisenAI:
                return this.instance = await this.model.engine.createThread();
        }
    }

    async sendMessage(...message){
        // TODO:FIXME: Abstract message data and sending/receiving methods

        switch(this.model.platform){
            case Platforms.OpenAI:
                return await this.instance.send(...message);

            case Platforms.GoogleAI:
                return await this.instance.sendMessage(...message);

            case Platforms.ArisenAI:
                return await this.instance.sendMessage(...message);
        }
    }
}


/**
 * @description Personality class
 */

class Personality {
    constructor(name){
        this.name = name;
        this.path = `./personalities/${name}`;

        if(!fs.existsSync(this.path)){
            return this.exists = false;
        }

        this.exists = true;
        this.config = configTools(parse(fs.readFileSync(this.path, "utf8"), { asLookupTable: true }));
        this.isSelfbot = this.config.block("bot").get("selfBot", Boolean);
        this.token = this.config.block("bot").get("token", String);
        this.lore = "Personality:\n" + this.config.block("person").properties.personality.join("\n").split("\n").map(thing => thing.trim()).join("\n").trim();
        this.application_id = this.config.block("bot").get("id", String);
    }
}


/**
 * @description Fetch, resize and encode an image for model viewing
 */

async function fetchImage(url, mimeType = "image/webp") {
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();

    let image = await sharp(buffer),
        meta = await image.metadata()
    ;
    
    let { format, height, width } = meta

    const compress = {
        jpeg: { quality: 80 },
        webp: { quality: 80 },
        png: { compressionLevel: 8 }
    }

    if(width > 300) {
        image = await image.resize({ width: 300 })
    } else if(height > 300) {
        image = await image.resize({ height: 300 })
    }

    image = image[format](compress[format])

    const resizedImageBuffer = await image.toBuffer();

    const base64Image = resizedImageBuffer.toString('base64');

    return {
        inlineData: {
            data: base64Image,
            mimeType
        },
    };
}


/**
 * @description Bot client class, used to run and manage the Discord bot
 * @param {AbstractModel} engine - The model to be used
 * @param {GetGeneralBotConfig} config - The general bot configuration
 */

class BotClient {
    constructor(engine, config){
        this.engine = engine;
        this.config = config;

        this.client = null;
        this.thread = null;

        this.history = [];
        this.queue = [];

        this.thinking = false;
        this.running = true;
        this.initialized = false;

        try{
            this.history = JSON.parse(fs.readFileSync("./history", "utf8"));
        } catch { }
    }


    async init(){
        const { personality, config: modelConfig } = this.engine;

        if(!modelConfig){
            throw new Error("Model not defined");
        }

        this.discord = personality.isSelfbot? DiscordSelfBot || (DiscordSelfBot = require("discord.js-selfbot-v13")): Discord || (Discord = require("discord.js"));

        // Initialize the model
        await this.engine.initModel();
    }


    resume(){
        this.running = true;
    }


    pause(){
        this.running = false;
    }


    async start() {
        const { personality, config: modelConfig } = this.engine;

        if(!this.initialized) await this.init();
        this.running = true;

        console.log("Starting a new bot, using model: ", modelConfig.properties, "and personality:", personality.name, "\n");

        console.log(personality.lore);

        if(this.client) this.client.destroy();

        this.client =
            personality.isSelfbot?
            new this.discord.Client():
            new this.discord.Client({ partials: [this.discord.Partials.Message, this.discord.Partials.Channel, this.discord.Partials.MessageReaction, this.discord.Partials.User,this.discord.Partials.GuildMessages, this.discord.PartialGroupDMChannel], intents: ['Guilds', 'GuildMessages', "GuildMembers", 'MessageContent', "DirectMessages", "DirectMessageTyping", "DirectMessageReactions", "GuildVoiceStates"] })
        ;

        // Bot commands
        if(!personality.isSelfbot){
            let rest = new this.discord.REST({version: "10"}).setToken(personality.token)

            this.createCommands();

            await rest.put(this.discord.Routes.applicationCommands(personality.application_id), { body: this.config.commands || this.commands });

            this.client.on("interactionCreate", $ => this.handleCommand($));
        }

        this.thread = await this.engine.createThread();

        // Finally, run and login the bot
        this.client.login(personality.token)

        this.client.on('messageCreate', $ => this.handleMessage($));

        this.client.once('ready', async () => {
            this.queueInterval()

            console.log("\n\nBot is running!");
            console.log(`Took: ${performance.now() - start}ms to startup`);
        })
    }


    saveMemory() {
        fs.writeFileSync("./history", JSON.stringify(this.history))
    }


    /**
     * @description Upload the current queue to the AI model
     */

    async uploadQueue(override) {
        if(!override) override = this.queue;

        if(this.thinking) return false;

        let attachments = [];
        for(let event of override){
            if(event.attachments && event.attachments.length){
                attachments.push(...event.attachments)
                event.attachments = "image"
            }
        }

        let data = JSON.stringify({
            events: override.filter(empty => empty),
            time: (`${new Date()}`).replace(" GMT+0200 (Central European Summer Time)", "")
        });

        this.history.push({
            role: "user",
            value: data
        })

        this.saveMemory()
    
        console.log("Pushing queued data: ", data);
        this.queue = []

        this.thinking = true

        console.log(attachments);
        
        const result = await this.thread.sendMessage(...attachments.length? [[data, ...attachments]] : [data]);
        const response = await result.response;
        const text = response.text();

        console.log("\nReceived raw chunk data: ", text);

        this.history.push({
            role: "bot",
            value: text
        })

        this.saveMemory()

        let parsed;
        try {
            parsed = JSON.parse(text);
            console.log("Received chunk data: ", parsed);
    
            // AI models tend to be very unreliable in returning consistent JSON results, so we need to handle all kinsa of scenarios.

            if(Array.isArray(parsed)) for(let event of parsed) await this.proccessEvent(event);
            else if (parsed.output && Array.isArray(parsed.output)) for(let event of parsed.output) await this.proccessEvent(event);
            else if (parsed.events && Array.isArray(parsed.events)) for(let event of parsed.events) await this.proccessEvent(event);
            else this.proccessEvent(parsed);

        } catch (e) {
            console.log("Could not parse response ", text, e);
        }

        this.thinking = false
    }


    async proccessEvent(event){
        if((event.type == "pm" || event.type == "open.pm") && event.channel){
            // The gemini models tend not to be too smart and confuse the OUTPUT events and rules a lot.
            // That is why we need such failsafes...
            event.type = "message"
        }
        
        let channel, target, typingInterval;

        switch(event.type){
            case "message":

                try {
                    if(/\D/.test(event.userID)) event.channel = snowflakeCompressor.decode(event.channel)
                } catch {}

                channel = this.client.channels.cache.get(event.channel);

                if(!channel){
                    try {
                        channel = await this.client.channels.fetch(event.channel)
                    } catch (e) {
                        console.error("Failed fetching channel " + event.channel);
                        console.error(e);
                        return
                    }
                }

                // console.log("Fetch channel to send: ", channel, "next response", event.next_reply);

                channel.sendTyping()
                typingInterval = setInterval(() => channel.sendTyping(), 9500)

                setTimeout(() => {
                    channel.send(event.value)
                    clearInterval(typingInterval)
                }, Math.min(80000, Math.max(850, (event.value.length * 45) + (Math.random() * 1178))))

                // {"type":"message","server":null,"channel":null,"content":"so, any cool projects you're working on lately?","next_reply":"10m"}
            break;

            case "message.react":

                channel = this.client.channels.cache.get(event.channel);

                if(!channel){
                    try {
                        channel = await this.client.channels.fetch(event.channel)
                    } catch (e) {
                        console.error("Failed fetching channel " + event.channel);
                        console.error(e);
                        return
                    }
                }

                // console.log("Fetch channel to send: ", channel, "next response", event.next_reply);

                try {
                    target = await channel.messages.fetch(event.target)
                } catch (e) {
                    console.error("Failed fetching message " + event.target);
                    console.error(e);
                    return
                }

                try {
                    target.react(event.value)
                } catch (e) {
                    console.error("Failed reacting to message message " + event.target);
                    console.error(e);
                    return
                }
            break;

            case "message.delete":

                channel = this.client.channels.cache.get(event.channel);

                if(!channel){
                    try {
                        channel = await this.client.channels.fetch(event.channel)
                    } catch (e) {
                        console.error("Failed fetching channel " + event.channel);
                        console.error(e);
                        return
                    }
                }

                // console.log("Fetch channel to send: ", channel, "next response", event.next_reply);

                try {
                    target = await channel.messages.fetch(event.target)
                } catch (e) {
                    console.error("Failed fetching message " + event.target);
                    console.error(e);
                    return
                }

                try {
                    target.delete()
                } catch (e) {
                    console.error("Failed deleting a message " + event.target);
                    console.error(e);
                    return
                }
            break;

            case "message.reply":

                channel = this.client.channels.cache.get(event.channel);

                if(!channel){
                    try {
                        channel = await this.client.channels.fetch(event.channel)
                    } catch (e) {
                        console.error("Failed fetching channel " + event.channel);
                        console.error(e);
                        return
                    }
                }

                // console.log("Fetch channel to send: ", channel, "next response", event.next_reply);

                try {
                    target = await channel.messages.fetch(event.target)
                } catch (e) {
                    console.error("Failed fetching message " + event.target);
                    console.error(e);
                    return
                }

                channel.sendTyping()
                typingInterval = setInterval(() => channel.sendTyping(), 9500)

                setTimeout(() => {
                    target.reply(event.value)
                    clearInterval(typingInterval)
                }, Math.min(80000, Math.max(850, (event.value.length * 45) + (Math.random() * 1178))))
            break;

            case "change.name":
                this.client.user.setUsername(event.value);
            break;

            case "open.pm": case "pm":
                try {
                    if(/\D/.test(event.userID)) event.userID = snowflakeCompressor.decode(event.userID)
                } catch {}

                try {
                    let user = await this.client.users.fetch(event.userID);
                    if(user) user.send(event.value); else console.error("Failed opening DM with ", event.userID);
                } catch (e) {
                    console.error("Failed opening DM", e)
                }
            break;

            case "change.status":
                console.log("Updating presence", event);

                this.client.user.setPresence({ 
                    activities: [{ 
                        type: discord.ActivityType.Custom,
                        name: "custom", 
                        state: event.value || "doing something"
                    }], 
                    status: event.status || "online"
                });
            break;

            case "server.leave":
                try {
                    bot.guilds.cache.get(event.server_id).leave()
                } catch(e) {
                    console.error("Could not leave server: ", e)
                }
            break;
        }
    }


    async queueInterval(){
        await sleep(14000 + (Math.random() * 6400))

        if(this.running) {
            if(this.queue.length > 0 && !this.thinking) {
                let previousCharCount = 0;

                const waitUntilFinish = async () => {
                    let charCount = 0, initial = this.queue.length;
    
                    for(let event of this.queue){
                        if(typeof event.value == "string") charCount += event.value.length
                    }

                    charCount = Math.max(0, charCount - previousCharCount)
    
                    let delay = Math.min(14200, Math.max(548, (charCount * 45) + (Math.random() * 952)));
                    console.log("Processing delay of " + charCount + " new characters, waiting " + delay + "ms");
    
                    await sleep(delay)
                    previousCharCount += charCount

                    if(this.queue.length > initial) {console.log("Queue has increased while waiting - waiting again..."); await waitUntilFinish()}
                }

                await waitUntilFinish()

                if(this.queue.length > 0 && !this.thinking) this.uploadQueue()
            }
        }

        return this.queueInterval()
    }


    async handleMessage(message) {
        if(this.engine.personality.isSelfbot){
            if(message.guildId){
                if(!this.config.data.block("bot").get("whitelist").includes(message.guildId)) return;
            }
        }

        if(this.client.user.id === message.author.id) return;

        if((message.member && this.client.user.id == message.member.id)) return;
        if(message.author.bot && !["1250380479333662721","786961609628712992", "1255045344815874100"].includes(message.author.id)) return;
        if(this.config.data.block("bot").get("channel_blacklist").includes(message.channelId)) return;
        if(this.config.data.block("bot").get("server_blacklist").includes(message.guildId)) return;

        // Dont allow bots to talk to each other in DMs
        if(!message.guildId && message.author.bot) return;

        let attachments = [];

        if (message.attachments.size > 0) {
            for (let attachment of message.attachments.values()){
                attachments.push(await fetchImage(attachment.url, attachment.contentType || "image/webp"))
            }
        }

        this.queue.push({
            type: message.guildId? "message": "pm",
            from: message.author.globalName || (message.author.id == "1250380479333662721"? "euri": message.author.id == "1255045344815874100"? "zinnia": null),
            // from_username: message.author.username,
            userID: snowflakeCompressor.encode(message.author.id),
            value: message.content,
            channel: snowflakeCompressor.encode(message.channelId),
            messageID: message.id,
            
            ...message.reference && message.reference.messageId? {
                replyingTo: message.reference.messageId
            }: {},

            ...attachments? {attachments}: {},

            ...message.guildId? {
                server_id: message.guildId,
                server_name: message.guild.name || "server",
                channel_name: message.channel.name || "channel",
            }: {}
        })

        console.log("Pushed event to queue: ", this.queue.at(-1));
    }


    createCommands(){
        const _this = this;

        return _this.commands = [
            {
                name: "debug-ping",
                description: "Ping-pong.",
    
                async action(interaction){
                    await interaction.reply(`Pong! Queue is ${_this.running? "enabled": "disabled"}. Size of the queue is: ${_this.queue.length}`);
                }
            },
            {
                name: "debug-qpush",
                description: "(debug) push queue manually",
    
                async action(interaction){
                    await interaction.reply('Done');
                    await _this.uploadQueue()
                }
            },
            {
                name: "debug-probe",
                description: "(debug) emulate free will",
    
                async action(interaction){
                    await interaction.reply('Done');
                    await _this.uploadQueue([])
                }
            },
            {
                name: "debug-qpause",
                description: "(debug) disable queue processing temporarily",
    
                async action(interaction){
                    _this.pause()
                    console.log("Queue proccessing paused");
                    await interaction.reply('Success');
                }
            },
            {
                name: "debug-qresume",
                description: "(debug) enable queue processing",
    
                async action(interaction){
                    _this.resume()
                    console.log("Queue proccessing resumed");
                    await interaction.reply('Success');
                }
            },
            {
                name: "debug-qclear",
                description: "(debug) clear queue",
    
                async action(interaction){
                    _this.queue = []
                    console.log("Queue cleared");
                    await interaction.reply('Success');
                }
            },
            {
                name: "debug-refresh-config",
                description: "(debug) hot-reload config of the bot and apply some of its changes without reloading the bot",
    
                async action(interaction){
                    await _this.config.refresh()
                }
            },
            {
                name: "debug-qget",
                description: "(debug) view queue",
    
                async action(interaction){
                    await interaction.reply(_this.queue.map((item, index) => `- **Event no. ${index}** \n\`\`\`json\n${JSON.stringify(item)}\n\`\`\``).join("\n") || "No events to show.");
                }
            },
            {
                name: "debug-gthread",
                description: "(debug) get current memory thread ID",
    
                async action(interaction){
                    await interaction.reply(_this.thread? _this.thread.id: "No thread attached!");
                }
            },
            {
                name: "debug-reset-thread",
                description: "(debug) reset and create a new memory thread - returns new thread ID",
    
                async action(interaction){
                    await interaction.reply("Threads are currently unavailable :(");
                    // await _this.engine.createThread()
                    // await interaction.reply(thread.id);
                }
            },
            {
                name: "debug-sthread",
                description: "(debug) restore a memory thread from ID",
                options: [{
                    name: 'input',
                    type: 3,
                    description: 'thread ID',
                    required: true
                }],
    
                async action(interaction){
                    try{
                        await retrieveThread(interaction.options.getString('input'))
                        await interaction.reply('Success');
                    } catch (e) {
                        console.error(e);
                        await interaction.reply('Failed');
                    }
                }
            },
            {
                name: "debug-delete-message",
                description: "(debug) Delete a message",
                options: [{
                    name: 'input',
                    type: 3,
                    description: 'thread ID',
                    required: true
                }],
    
                async action(interaction){
                    channel = interaction.channel;
    
                    try {
                        target = await channel.messages.fetch(event.target)
                    } catch (e) {
                        console.error("Failed fetching message " + event.target);
                        console.error(e);
                        return
                    }
    
                    try {
                        target.delete()
                    } catch (e) {
                        console.error("Failed deleting a message " + event.target);
                        console.error(e);
                        return
                    }
                }
            },
            {
                name: "debug-emulate",
                description: "(debug) emulate a custom queue OUTPUT event",
                options: [{
                    name: 'input',
                    type: 3,
                    description: 'object OUTPUT event',
                    required: true
                }],
    
                async action(interaction){
                    try{
    
                        let event = JSON.parse(interaction.options.getString('input'));
                        _this.proccessEvent(event)
        
                        await interaction.reply('Success');
                        
                    } catch (e) {
                        console.error(e);
                        await interaction.reply('Failed');
                    }
                }
            },
            {
                name: "debug-qadd",
                description: "(debug) emulate a custom queue INPUT event",
                options: [{
                    name: 'input',
                    type: 3,
                    description: 'object INPUT event',
                    required: true
                }],
    
                async action(interaction){
                    try{
    
                        let event = JSON.parse(interaction.options.getString('input'));
                        _this.queue.push(event)
        
                        await interaction.reply('Success');
                        
                    } catch (e) {
                        console.error(e);
                        await interaction.reply('Failed');
                    }
                }
            },
            {
                name: "debug-qremove",
                description: "(debug) remove a specific queue item, can be a comma separated list",
                options: [{
                    name: 'input',
                    type: 3,
                    description: 'item to remove',
                    required: true
                }],
    
                async action(interaction){
                    try{
    
                        let index = + interaction.options.getString('input')
                        delete _this.queue[index]
                        _this.queue = _this.queue.filter(empty => empty)
        
                        await interaction.reply('Success');
                        
                    } catch (e) {
                        console.error(e);
                        await interaction.reply('Failed');
                    }
                }
            },
        ]
    }


    async handleCommand(interaction) {
        if(!interaction.isChatInputCommand()) return;

        try {
            if(interaction.commandName.startsWith("debug") && !this.config.data.block("bot").get("admins").includes(interaction.user.username)) {
                return interaction.reply(interaction.user.username + ' is unauthorized to use debug commands');
            }

            const handler = this.commands.find(command => command.name === interaction.commandName)

            if(handler) await handler.action(interaction); else {
                await interaction.reply('Unknown command used');
            }
        } catch(error) {
            console.error(error)
        }
    }
}


// This is only useful for some certain models
let snowflakeCompressor = {
    encode(str) {
        return str;
        const bigInt = BigInt(str);
        const buffer = Buffer.allocUnsafe(8);
        buffer.writeBigUInt64BE(bigInt);
        return buffer.toString('base64');
    },
    
    decode(base64Str) {
        return base64Str;
        const buffer = Buffer.from(base64Str, 'base64');
        const bigInt = buffer.readBigUInt64BE();
        return bigInt.toString();
    }
}

function sleep(ms){
    return new Promise(resolve => setTimeout(resolve, ms))
}

module.exports = { GetGeneralBotConfig, BotClient, Platforms, Personality, AbstractModel };