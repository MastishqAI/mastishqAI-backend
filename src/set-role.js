// Promote (or demote) an existing account. Run on the server by the site owner:
//   sudo bash -c 'set -a; . /etc/mastishq/api.env; set +a; cd /opt/mastishq/backend && node src/set-role.js someone@school.com teacher'
// roles: student | teacher | admin
require("dotenv").config();
const mongoose = require("mongoose");
const { User } = require("./models");

(async () => {
  const [email, role] = process.argv.slice(2);
  if (!email || !["student", "teacher", "admin"].includes(role)) {
    console.error("Usage: node src/set-role.js <email> <student|teacher|admin>");
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI);
  const u = await User.findOneAndUpdate({ email: email.toLowerCase() }, { role, ...(role !== "student" && { onboarded: true }) }, { new: true });
  console.log(u ? `${u.email} is now: ${u.role}` : `No account with email ${email}`);
  await mongoose.disconnect();
  process.exit(u ? 0 : 2);
})().catch((e) => { console.error(e.message); process.exit(1); });
