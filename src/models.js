const mongoose = require("mongoose");
const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

const User = model("User", new Schema({
  name: { type: String, required: true },
  firstName: String,
  lastName: String,
  email: { type: String, required: true, unique: true, lowercase: true },
  passwordHash: String,
  googleId: { type: String, index: true, sparse: true },
  picture: String,
  role: { type: String, enum: ["student", "teacher", "admin"], default: "student" },
  phone: String,
  school: String,
  className: String,
  board: String,
  district: String,
  state: String,
  pincode: String,
  goalName: String,
  goalText: String,
  dailyGoal: { type: Number, default: 10 },
  subjects: [String],
  goalId: { type: ObjectId, ref: "Goal" },
  subjectIds: [{ type: ObjectId, ref: "Subject" }],
  onboarded: { type: Boolean, default: false },
  resetToken: String,
  resetTokenExpires: Date,
  plan: { type: String, enum: ["free", "pro"], default: "free" },
  planExpiresAt: Date,
  country: { type: String, default: "India" },
  referralCode: { type: String, unique: true, sparse: true },
  referredBy: { type: ObjectId, ref: "User" },
  referralRewarded: { type: Boolean, default: false },
  referralRewardsGiven: { type: Number, default: 0 },
  bonusChats: { type: Number, default: 0 },
}, { timestamps: true }));

// one row per Razorpay order; paymentId is unique so a payment can never be credited twice
const Payment = model("Payment", new Schema({
  userId: { type: ObjectId, ref: "User", index: true },
  orderId: { type: String, unique: true },
  paymentId: { type: String, unique: true, sparse: true },
  amount: Number,
  currency: { type: String, default: "INR" },
  days: Number,
  status: { type: String, enum: ["created", "paid", "failed"], default: "created" },
  paidAt: Date,
}, { timestamps: true }));

const Goal = model("Goal", new Schema({ name: String, description: String, order: Number }));
const Subject = model("Subject", new Schema({ name: String, icon: String, description: String }));
const Topic = model("Topic", new Schema({
  subjectId: { type: ObjectId, ref: "Subject", index: true },
  title: String, description: String, videoUrl: String, order: Number,
}));

const questionSchema = new Schema({
  text: String, options: [String], correctIndex: Number, explanation: String,
}, { _id: true });

const Quiz = model("Quiz", new Schema({
  topicId: { type: ObjectId, ref: "Topic" },
  ownerId: { type: ObjectId, ref: "User" },
  title: String, topic: String, difficulty: String,
  source: { type: String, enum: ["manual", "ai"], default: "manual" },
  questions: [questionSchema],
}, { timestamps: true }));

const QuizAttempt = model("QuizAttempt", new Schema({
  userId: { type: ObjectId, ref: "User", index: true },
  quizId: { type: ObjectId, ref: "Quiz" },
  answers: [{ questionId: ObjectId, selectedIndex: Number, correct: Boolean }],
  score: Number, total: Number, xp: Number,
}, { timestamps: true }));

const UserStats = model("UserStats", new Schema({
  userId: { type: ObjectId, ref: "User", unique: true },
  totalXp: { type: Number, default: 0 },
  level: { type: Number, default: 0 },
  currentStreak: { type: Number, default: 0 },
  longestStreak: { type: Number, default: 0 },
  lastActiveDate: String,
  badges: [String],
  badgeDates: { type: Schema.Types.Mixed, default: {} },
  diagnosticDone: { type: Boolean, default: false },
  answered: { type: Number, default: 0 },
  correct: { type: Number, default: 0 },
  accuracy: { type: Number, default: 0 },
  avgMinutes: { type: Number, default: 0 },
  attemptCount: { type: Number, default: 0 },
}, { timestamps: true }));

const XpEvent = model("XpEvent", new Schema({
  userId: { type: ObjectId, ref: "User", index: true },
  type: String, xp: Number, meta: Schema.Types.Mixed,
}, { timestamps: true }));

const Conversation = model("Conversation", new Schema({
  userId: { type: ObjectId, ref: "User", index: true },
  title: String,
  messages: [{ role: String, content: String, at: { type: Date, default: Date.now } }],
}, { timestamps: true }));

const Room = model("Room", new Schema({
  name: String, subject: String, topic: String, goals: [String],
  maxLearners: { type: Number, default: 4 },
  isPrivate: { type: Boolean, default: false },
  ownerId: { type: ObjectId, ref: "User" },
  members: [{ type: ObjectId, ref: "User" }],
  invited: [{ type: ObjectId, ref: "User" }],
}, { timestamps: true }));

const Notification = model("Notification", new Schema({
  userId: { type: ObjectId, ref: "User", index: true },
  type: String, title: String, body: String,
  read: { type: Boolean, default: false },
  data: Schema.Types.Mixed,
}, { timestamps: true }));

const Homework = model("Homework", new Schema({
  teacherId: { type: ObjectId, ref: "User" },
  title: String, description: String, dueDate: Date,
  questions: [{ text: String }],
  published: { type: Boolean, default: false },
}, { timestamps: true }));

const Submission = model("Submission", new Schema({
  homeworkId: { type: ObjectId, ref: "Homework", index: true },
  studentId: { type: ObjectId, ref: "User", index: true },
  answers: [{ questionId: ObjectId, answer: String }],
  submitted: { type: Boolean, default: false },
  grade: Number, feedback: String,
}, { timestamps: true }));

// ---- practice: a topic with Easy / Medium / Hard stages ----
const stageState = { status: { type: String, default: "locked" }, attempts: { type: Number, default: 0 }, best: { type: Number, default: 0 } };
const Practice = model("Practice", new Schema({
  userId: { type: ObjectId, ref: "User", index: true },
  type: { type: String, default: "practice" }, // practice | diagnostic
  topic: String, description: String, subject: String,
  secondsPerQuestion: { type: Number, default: 60 },
  materialIds: [{ type: ObjectId, ref: "Material" }],
  stages: {
    easy: { ...stageState, status: { type: String, default: "open" } },
    medium: stageState,
    hard: stageState,
    diagnostic: stageState,
  },
}, { timestamps: true }));

const attemptQuestion = new Schema({
  text: String, options: [String], correctIndex: Number, explanation: String, subtopic: String,
  source: String,
  steps: Schema.Types.Mixed,
  selectedIndex: { type: Number, default: null },
  correct: { type: Boolean, default: null },
  timeSec: { type: Number, default: 0 },
  tags: [String],
}, { _id: true });

const StageAttempt = model("StageAttempt", new Schema({
  userId: { type: ObjectId, ref: "User", index: true },
  practiceId: { type: ObjectId, ref: "Practice", index: true },
  stage: String, attemptNo: Number,
  topic: String, subject: String,
  pointsEach: Number, passMark: Number,
  secondsPerQuestion: Number,
  questions: [attemptQuestion],
  status: { type: String, default: "in_progress" },
  score: Number, maxScore: Number, cleared: Boolean, timeSec: Number,
  earned: Number, badge: String,
}, { timestamps: true }));

const Mistake = model("Mistake", new Schema({
  userId: { type: ObjectId, ref: "User", index: true },
  key: String,
  text: String, options: [String], correctIndex: Number, explanation: String,
  subject: String, topic: String,
  tags: [String],
  status: { type: String, enum: ["open", "fixing", "fixed"], default: "open" },
  tries: { type: Number, default: 1 },
  fixCorrect: { type: Number, default: 0 },
  lastAt: Date,
  similar: { text: String, options: [String], correctIndex: Number, explanation: String },
}, { timestamps: true }));

// Rotating refresh tokens: only a SHA-256 hash is stored; `family` ties a login session together
const RefreshToken = model("RefreshToken", new Schema({
  userId: { type: ObjectId, ref: "User", index: true },
  tokenHash: { type: String, unique: true },
  family: { type: String, index: true },
  expiresAt: { type: Date, index: { expireAfterSeconds: 0 } }, // Mongo removes expired rows
  revokedAt: Date,
  replacedBy: String,
  userAgent: String,
  ip: String,
}, { timestamps: true }));

// 👍 / 👎 on AI answers and "report" flags on questions or answers
const Feedback = model("Feedback", new Schema({
  userId: { type: ObjectId, ref: "User", index: true },
  attemptId: { type: ObjectId, ref: "StageAttempt" },
  questionId: ObjectId,
  kind: { type: String, enum: ["helpful", "not_helpful", "report_answer", "report_question"] },
  question: String,
  answer: String,        // the AI reply that was rated / reported
  answerKey: String,     // hash of the reply, so one answer gets one rating per learner
  note: String,
  status: { type: String, default: "new" },
}, { timestamps: true }));

// "Help & Support" queries raised from the app (attachments are stored on disk, never served publicly)
const SupportTicket = model("SupportTicket", new Schema({
  userId: { type: ObjectId, ref: "User", index: true },
  name: String, email: String,
  message: String,
  attachments: [{ originalName: String, storedName: String, mime: String, size: Number }],
  status: { type: String, enum: ["open", "in_progress", "resolved"], default: "open" },
}, { timestamps: true }));

// one row per OpenAI call: tokens used and an ESTIMATED cost (see lib/usage.js)
const usageSchema = new Schema({
  userId: { type: ObjectId, ref: "User", index: true },
  feature: String,                // quiz | verify | tutor | ask_why | steps | similar
  model: String,
  inputTokens: { type: Number, default: 0 },
  outputTokens: { type: Number, default: 0 },
  searches: { type: Number, default: 0 },
  costUsd: { type: Number, default: 0 },
}, { timestamps: true });
usageSchema.index({ createdAt: -1 });
const UsageLog = model("UsageLog", usageSchema);

// how many AI actions a learner has used today (per feature), for the daily limits
const quotaSchema = new Schema({
  userId: { type: ObjectId, ref: "User" },
  day: String,                    // YYYY-MM-DD in Indian time
  quiz: { type: Number, default: 0 },
  chat: { type: Number, default: 0 },
  search: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now, expires: 3 * 86400 },   // old days are removed automatically
});
quotaSchema.index({ userId: 1, day: 1 }, { unique: true });
const AiQuota = model("AiQuota", quotaSchema);

// ---- learner-uploaded study material (RAG): the file lives in S3 / local storage, its text is split into chunks ----
const NINETY_DAYS = 90 * 24 * 3600;
const Material = model("Material", new Schema({
  userId: { type: ObjectId, ref: "User", index: true },
  name: String, mime: String, size: Number,
  storage: String, storageKey: String,
  pages: Number, chars: Number,
  createdAt: { type: Date, default: Date.now, expires: NINETY_DAYS },
}));
const Chunk = model("Chunk", new Schema({
  materialId: { type: ObjectId, ref: "Material", index: true },
  userId: { type: ObjectId, index: true },
  order: Number, text: String,
  embedding: { type: [Number], default: undefined },
  createdAt: { type: Date, default: Date.now, expires: NINETY_DAYS },
}));

module.exports = {
  UsageLog, AiQuota, Payment, Material, Chunk,
  SupportTicket,
  Feedback,
  RefreshToken,
  User, Goal, Subject, Topic, Quiz, QuizAttempt, UserStats, XpEvent,
  Conversation, Room, Notification, Homework, Submission,
  Practice, StageAttempt, Mistake,
};
