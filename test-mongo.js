// Test MongoDB Connection
const mongoose = require('mongoose');

const MONGODB_URI = "mongodb+srv://rajkumarpadhy2006_db_user:kPLQjWVImT0b1qeK@phishingshield2.djpgktm.mongodb.net/phishingshield?retryWrites=true&w=majority";

async function testConnection() {
    try {
        console.log("Testing MongoDB connection...");
        console.log("URI:", MONGODB_URI.replace(/:[^:@]+@/, ':****@')); // Hide password

        await mongoose.connect(MONGODB_URI, {
            serverSelectionTimeoutMS: 10000,
        });

        console.log("✅ MongoDB Connected Successfully!");
        console.log("Database:", mongoose.connection.db.databaseName);

        // List collections
        const collections = await mongoose.connection.db.listCollections().toArray();
        console.log("Collections:", collections.map(c => c.name));

        await mongoose.disconnect();
        console.log("Disconnected.");

    } catch (error) {
        console.error("❌ MongoDB Connection Failed:");
        console.error("Error:", error.message);
        console.error("Full error:", error);
    }
}

testConnection();
