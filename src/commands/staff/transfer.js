const Discord = require("discord.js");

const Config = require('../../../config.json');
const MiscConfigs = require('../../../config/misc-configs.js');
const db = require('../../database.js');

exports.description = "Transfers user account and balance to a new account.";

/**
 * Transfers user account and balance to a new account.
 *
 * @param {Discord.Client} client
 * @param {Discord.Message} message
 * @param {Array} args
 * @returns void
 */
exports.run = async (client, message, args) => {

    if (!message.member.roles.cache.find((r) => r.id === Config.DiscordBot.Roles.Staff)) return;

    const modlog = message.guild.channels.cache.find(
        (channel) => channel.id === MiscConfigs.modLogs,
    );

    if (args.length < 3) {
        message.reply("usage: " + Config.DiscordBot.Prefix + "staff transfer <OLDUSERID> <NEWUSERID>.");
    } else {
        let old = await db.getUserData(args[1]);

        if (old == null) {
            message.reply("That account is not linked with a console account :sad:");
        } else {
            if (!message.guild.members.cache.get(args[2])) {
                message.reply("Couldn't find a user with the ID: " + args[2]);
                return;
            }

            let newData = await db.getUserData(args[2]);

            const oldConsoleId = old.console_id ?? old.consoleID;
            const newConsoleId = newData ? (newData.console_id ?? newData.consoleID) : null;

            if (!newData || oldConsoleId != newConsoleId) {
                message.reply(
                    "Both accounts should be linked to the same panel account in order for this command to work.",
                );
                return;
            }

            let { donated, used } = await db.getUserPrem(args[1]) || {
                donated: 0,
                used: 0,
            };
            let newM = await db.getUserPrem(args[2]) || {
                donated: 0,
                used: 0,
            };

            await db.setUserPrem(args[2], {
                used: used + newM.used,
                donated: donated + newM.donated,
            });

            await db.deleteUserPrem(args[1]);

            message.reply("Done!");

            if (modlog) {
                modlog.send({
                    embeds: new Discord.EmbedBuilder()
                        .setTitle("Premium Balance Transfer")
                        .addFields(
                            {
                                name: "From:",
                                value: args[1],
                                inline: true
                            },
                            {
                                name: "To:",
                                value: args[2],
                                inline: true
                            }
                        )
                        .setDescription(`Added ${donated} credits and ${used} used.`)
                        .setFooter({ text: "Executed by: " + message.author.tag}),
                });
            }
        }
    }
};
