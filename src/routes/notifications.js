const router = require("express").Router();
const { Notification, Room } = require("../models");
const { auth, wrap } = require("../middleware");

router.use(auth);

router.get("/", wrap(async (req, res) => {
  const list = await Notification.find({ userId: req.user.id }).sort("-createdAt").limit(50);
  res.json({ success: true, notifications: list, unread: list.filter((n) => !n.read).length });
}));

router.patch("/read-all", wrap(async (req, res) => {
  await Notification.updateMany({ userId: req.user.id, read: false }, { read: true });
  res.json({ success: true });
}));

router.patch("/:id/read", wrap(async (req, res) => {
  await Notification.updateOne({ _id: req.params.id, userId: req.user.id }, { read: true });
  res.json({ success: true });
}));

router.post("/:id/accept-invite", wrap(async (req, res) => {
  const n = await Notification.findOne({ _id: req.params.id, userId: req.user.id, type: "room_invite" });
  if (!n) return res.status(404).json({ success: false, message: "Invite not found" });
  const room = await Room.findById(n.data?.roomId);
  if (room && !room.members.some((m) => String(m) === req.user.id) && room.members.length < room.maxLearners) {
    room.members.push(req.user.id);
    await room.save();
  }
  n.read = true;
  await n.save();
  res.json({ success: true });
}));

router.post("/:id/reject-invite", wrap(async (req, res) => {
  const n = await Notification.findOne({ _id: req.params.id, userId: req.user.id, type: "room_invite" });
  if (!n) return res.status(404).json({ success: false, message: "Invite not found" });
  n.read = true;
  await n.save();
  res.json({ success: true });
}));

module.exports = router;
