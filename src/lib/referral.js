const { User, Notification } = require("../models");

const BONUS = 5;               // extra AI chats for each side
const MAX_REWARDED = 10;       // one learner can earn this many invite rewards (so 50 bonus chats at most)

// Called when a learner clears a stage. Pays out once, the first time, for someone who joined with an invite link.
async function rewardReferral(userId) {
  const u = await User.findOneAndUpdate({ _id: userId, referredBy: { $ne: null }, referralRewarded: { $ne: true } }, { $set: { referralRewarded: true } });
  if (!u) return false;
  await User.updateOne({ _id: u._id }, { $inc: { bonusChats: BONUS } });
  await Notification.create({ userId: u._id, type: "achievement", title: `+${BONUS} bonus chats`, body: "Thanks for joining through a friend's invite. Your bonus chats are ready to use." });
  const ref = await User.findOneAndUpdate({ _id: u.referredBy, referralRewardsGiven: { $lt: MAX_REWARDED } }, { $inc: { bonusChats: BONUS, referralRewardsGiven: 1 } });
  if (ref) await Notification.create({ userId: ref._id, type: "achievement", title: `+${BONUS} bonus chats`, body: "A friend you invited finished their first level, so you both got extra AI chats." });
  return true;
}

module.exports = { rewardReferral, BONUS, MAX_REWARDED };
