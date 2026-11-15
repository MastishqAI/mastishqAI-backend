require("dotenv").config();
if (process.env.NODE_ENV === "production") {
  console.error("Refusing to run the demo seed in production: it wipes the database and creates accounts with a known password.");
  process.exit(1);
}
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const {
  User, Goal, Subject, Topic, Quiz, UserStats, QuizAttempt, XpEvent, Room,
  Practice, StageAttempt, Mistake, Conversation, Notification,
} = require("./models");
const { levelInfo } = require("./lib/xp");

const goals = [
  ["NEET Preparation", "Medical entrance for MBBS / BDS / AYUSH"],
  ["JEE Preparation", "Engineering entrance Mains & Advanced"],
  ["Board Exams", "CBSE, ICSE or State Board finals"],
  ["Civil Services (UPSC)", "IAS, IPS, IFS and allied services"],
  ["Olympiad / Competitive", "National & international competitions"],
  ["CA / Commerce", "Chartered Accountancy and commerce streams"],
  ["Other Exams", "Current affairs, Reasoning & aptitude"],
];

// name, email, points, streak days, accuracy %, avg minutes
const learners = [
  ["Akash Srivastava", "student@smartlearn.com", 1250, 7, 71, 30],
  ["Rohan Verma", "rohan@smartlearn.com", 4210, 35, 88, 35],
  ["Ananya Iyer", "ananya@smartlearn.com", 4050, 21, 86, 40],
  ["Kabir Singh", "kabir@smartlearn.com", 3880, 19, 84, 45],
  ["Meera Nair", "meera@smartlearn.com", 3640, 30, 85, 50],
  ["Aditya Rao", "aditya@smartlearn.com", 3410, 12, 81, 55],
  ["Ishita Gupta", "ishita@smartlearn.com", 3190, 16, 83, 60],
  ["Vivek Kumar", "vivek@smartlearn.com", 2980, 9, 79, 65],
  ["Diya Joshi", "diya@smartlearn.com", 2760, 14, 80, 70],
  ["Harsh Malhotra", "harsh@smartlearn.com", 2530, 8, 77, 75],
  ["Nisha Reddy", "nisha@smartlearn.com", 2310, 11, 78, 80],
  ["Aman Chauhan", "aman@smartlearn.com", 1960, 6, 74, 90],
  ["Pooja Das", "pooja@smartlearn.com", 1720, 10, 76, 95],
  ["Riya Kapoor", "riya@smartlearn.com", 1290, 5, 72, 105],
  ["Sahil Bansal", "sahil@smartlearn.com", 1210, 4, 70, 110],
  ["Tanvi Mishra", "tanvi@smartlearn.com", 1180, 3, 73, 115],
];

// demo learners are spread across goals so the per-goal leaderboard is visible
const GOALS_BY_EMAIL = {
  "kabir@smartlearn.com": "JEE Preparation", "meera@smartlearn.com": "JEE Preparation", "ishita@smartlearn.com": "JEE Preparation",
  "diya@smartlearn.com": "JEE Preparation", "pooja@smartlearn.com": "JEE Preparation",
  "sahil@smartlearn.com": "Board Exams", "tanvi@smartlearn.com": "Board Exams",
};

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  await Promise.all([User, Goal, Subject, Topic, Quiz, UserStats, QuizAttempt, XpEvent, Room, Practice, StageAttempt, Mistake, Conversation, Notification].map((m) => m.deleteMany({})));
  await Goal.insertMany(goals.map(([name, description], i) => ({ name, description, order: i + 1 })));

  const hash = await bcrypt.hash("password123", 10);
  const today = new Date().toISOString().slice(0, 10);
  for (const [name, email, points, streak, accuracy, avgMinutes] of learners) {
    const [firstName, ...rest] = name.split(" ");
    const u = await User.create({
      name, firstName, lastName: rest.join(" "), email, role: "student", passwordHash: hash, onboarded: true,
      goalName: GOALS_BY_EMAIL[email] || "NEET Preparation", district: "Noida", state: "Uttar Pradesh", school: "Delhi Public School", className: "12th",
      subjects: ["Physics", "Chemistry", "Biology"], dailyGoal: 40,
    });
    await UserStats.create({
      userId: u._id, totalXp: points, level: levelInfo(points).level, currentStreak: streak, longestStreak: streak + 3,
      lastActiveDate: today, badges: points >= 100 ? ["Rookie"] : [], diagnosticDone: true, accuracy, avgMinutes,
      answered: 200, correct: Math.round(2 * accuracy), attemptCount: 10,
    });
  }
  await User.create({ name: "Demo Teacher", firstName: "Demo", lastName: "Teacher", email: "teacher@smartlearn.com", role: "teacher", passwordHash: hash, onboarded: true });
  // a brand-new learner to see the first-run "Level 0" experience
  await User.create({ name: "New Learner", firstName: "New", lastName: "Learner", email: "new@smartlearn.com", role: "student", passwordHash: hash, onboarded: true, goalName: "NEET Preparation", subjects: ["Physics", "Biology"], dailyGoal: 20 });

  console.log("Seeded demo data. Logins (password: password123): student@smartlearn.com (Level 3), new@smartlearn.com (Level 0), teacher@smartlearn.com");
  await mongoose.disconnect();
}

run().catch((e) => { console.error(e); process.exit(1); });
