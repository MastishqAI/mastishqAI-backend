const router = require("express").Router();
const { Room, User, Notification } = require("../models");
const { auth, wrap } = require("../middleware");

router.use(auth);

const view = (r, uid) => ({
  id: r._id, name: r.name, subject: r.subject, topic: r.topic, goals: r.goals,
  maxLearners: r.maxLearners, isPrivate: r.isPrivate,
  memberCount: r.members.length, isMember: r.members.some((m) => String(m._id || m) === uid),
  isOwner: String(r.ownerId?._id || r.ownerId) === uid,
  owner: r.ownerId?.name,
});

router.post("/", wrap(async (req, res) => {
  const { name, topic, subject, goals, maxLearners, isPrivate } = req.body;
  if (!name && !topic) return res.status(400).json({ success: false, message: "Room name or topic is required" });
  const room = await Room.create({
    name: name || topic, topic, subject, goals: goals || [],
    maxLearners: Math.min(Math.max(parseInt(maxLearners, 10) || 4, 2), 20),
    isPrivate: !!isPrivate, ownerId: req.user.id, members: [req.user.id],
  });
  res.status(201).json({ success: true, room: view(room, req.user.id) });
}));

// rooms the user is in
router.get("/", wrap(async (req, res) => {
  const rooms = await Room.find({ members: req.user.id }).populate("ownerId", "name").sort("-updatedAt");
  res.json({ success: true, rooms: rooms.map((r) => view(r, req.user.id)) });
}));

router.get("/discover", wrap(async (req, res) => {
  const rooms = await Room.find({ isPrivate: false, members: { $ne: req.user.id } }).populate("ownerId", "name").sort("-createdAt").limit(30);
  res.json({ success: true, rooms: rooms.filter((r) => r.members.length < r.maxLearners).map((r) => view(r, req.user.id)) });
}));

router.get("/:id", wrap(async (req, res) => {
  const room = await Room.findById(req.params.id).populate("ownerId", "name").populate("members", "name");
  if (!room) return res.status(404).json({ success: false, message: "Room not found" });
  res.json({ success: true, room: { ...view(room, req.user.id), members: room.members.map((m) => ({ id: m._id, name: m.name })) } });
}));

router.post("/:id/join", wrap(async (req, res) => {
  const room = await Room.findById(req.params.id);
  if (!room) return res.status(404).json({ success: false, message: "Room not found" });
  const invited = room.invited.some((i) => String(i) === req.user.id);
  if (room.isPrivate && !invited) return res.status(403).json({ success: false, message: "This room is invite-only" });
  if (room.members.some((m) => String(m) === req.user.id)) return res.json({ success: true, message: "Already a member" });
  if (room.members.length >= room.maxLearners) return res.status(409).json({ success: false, message: "Room is full" });
  room.members.push(req.user.id);
  await room.save();
  res.json({ success: true });
}));

router.post("/:id/leave", wrap(async (req, res) => {
  const room = await Room.findById(req.params.id);
  if (!room) return res.status(404).json({ success: false, message: "Room not found" });
  room.members = room.members.filter((m) => String(m) !== req.user.id);
  await room.save();
  res.json({ success: true });
}));

router.get("/:id/invite-users", wrap(async (req, res) => {
  const room = await Room.findById(req.params.id);
  const users = await User.find({ _id: { $nin: [...room.members, ...room.invited] }, role: "student" }).select("name email").limit(30);
  res.json({ success: true, users });
}));

router.post("/:id/invite", wrap(async (req, res) => {
  const room = await Room.findById(req.params.id);
  if (!room) return res.status(404).json({ success: false, message: "Room not found" });
  if (String(room.ownerId) !== req.user.id) return res.status(403).json({ success: false, message: "Only the room owner can invite" });
  const ids = (req.body.userIds || []).filter((id) => !room.invited.some((i) => String(i) === id));
  room.invited.push(...ids);
  await room.save();
  await Notification.insertMany(ids.map((id) => ({
    userId: id, type: "room_invite", title: "Study room invite",
    body: `You were invited to "${room.name}".`, data: { roomId: room._id },
  })));
  res.json({ success: true, invited: ids.length });
}));

module.exports = router;
