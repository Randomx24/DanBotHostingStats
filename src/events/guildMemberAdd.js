const Discord = require("discord.js");

const Config = require("../../config.json");
const db = require("../database.js");

/**
 *
 * @param {Discord.Client} client
 * @param {Discord.GuildMember} member
 * @param {Discord.Guild} guild
 * @returns
 */
module.exports = async (client, member, guild) => {

    // If the user is a bot, returns.
    if (member.user.bot) return;

    const userAccount = await db.getUserData(member.id);

    // Ensure a userPrem row exists with defaults.
    await db.ensureUserPrem(member.id);
    const userPremium = await db.getUserPrem(member.id);

    //If the user has a console account linked, give them the client role.
    if (userAccount !== null) {
        await member.roles.add(Config.DiscordBot.Roles.Client).catch((Error) => {});
    };

    //If the user has donated before, gives them the donator role.
    if(userPremium != null && userPremium.donated > 0){
        await member.roles.add(Config.DiscordBot.Roles.Donator).catch((Error) => {});
    }
};
