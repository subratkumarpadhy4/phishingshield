// Reset User Password
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI;

// User Schema
const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: String,
    name: String,
    xp: { type: Number, default: 0 },
    level: { type: Number, default: 1 }
});

const User = mongoose.model('User', userSchema);

async function resetPassword() {
    try {
        console.log("Connecting to MongoDB...");
        await mongoose.connect(MONGODB_URI, {
            serverSelectionTimeoutMS: 10000,
        });

        console.log("✅ Connected!");

        const email = "padhysubratkumar7@gmail.com";
        const newPassword = "admin123"; // Change this to your desired password

        // Find user
        const user = await User.findOne({ email: email.toLowerCase() });

        if (!user) {
            console.log("❌ User not found:", email);
            await mongoose.disconnect();
            return;
        }

        console.log("✅ User found:", user.email);
        console.log("   Name:", user.name);
        console.log("   XP:", user.xp);
        console.log("   Level:", user.level);

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update password
        user.password = hashedPassword;
        await user.save();

        console.log("\n✅ Password reset successfully!");
        console.log("   New password:", newPassword);
        console.log("\nYou can now login with:");
        console.log("   Email:", email);
        console.log("   Password:", newPassword);

        await mongoose.disconnect();

    } catch (error) {
        console.error("❌ Error:", error.message);
    }
}

resetPassword();
