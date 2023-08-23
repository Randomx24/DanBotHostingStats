exports.run = async (client, message, args) => {
    if (message.channel.name.includes("-ticket")) {
        message.reply("Now all staff can see your ticket.");
        await message.channel.updateOverwrite("898041751099539497", {
            VIEW_CHANNEL: true,
            SEND_MESSAGES: true,
            READ_MESSAGE_HISTORY: true,
        });
    } else {
        message.reply("This command is only to be used inside of ticket channels.");
    }
};