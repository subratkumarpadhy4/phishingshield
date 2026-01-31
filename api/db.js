const mongoose = require('mongoose');
const path = require('path');
// Only load dotenv for local development - Vercel provides env vars automatically
if (!process.env.VERCEL) {
    require('dotenv').config({ path: path.join(__dirname, '../.env') });
}

// MongoDB connection string - supports both local and cloud (MongoDB Atlas)
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/phishingshield';

let isConnected = false;

// Connect to MongoDB
async function connectDB() {
    if (isConnected) {
        console.log('[MongoDB] Already connected');
        return;
    }

    try {
        await mongoose.connect(MONGODB_URI, {
            serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
        });
        isConnected = true;
        console.log('[MongoDB] ✓ Connected successfully');

        // Handle connection events
        mongoose.connection.on('error', (err) => {
            console.error('[MongoDB] Connection error:', err);
            isConnected = false;
        });

        mongoose.connection.on('disconnected', () => {
            console.warn('[MongoDB] Disconnected');
            isConnected = false;
        });

        mongoose.connection.on('reconnected', () => {
            console.log('[MongoDB] Reconnected');
            isConnected = true;
        });
    } catch (error) {
        console.error('[MongoDB] ✗ Connection failed:', error.message);
        console.warn('[MongoDB] Falling back to JSON file storage');
        isConnected = false;
        throw error;
    }
}

// Schemas
const TrustScoreSchema = new mongoose.Schema({
    domain: { type: String, required: true, unique: true, lowercase: true, trim: true },
    safe: { type: Number, default: 0 },
    unsafe: { type: Number, default: 0 },
    voters: { type: mongoose.Schema.Types.Mixed, default: {} }, // Object<userId, 'safe'|'unsafe'> - Using Mixed for email keys with dots
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

// Index already defined in schema (unique: true), so skip duplicate
// TrustScoreSchema.index({ domain: 1 });

const ReportSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    url: { type: String, required: true },
    hostname: { type: String, required: true },
    userId: { type: String },
    userName: { type: String },
    userEmail: { type: String },
    reporter: { type: String },
    reporterName: { type: String },
    reporterEmail: { type: String },
    timestamp: { type: Number, required: true },
    status: { type: String, default: 'pending', enum: ['pending', 'banned', 'ignored'] },
    lastUpdated: { type: Number, default: Date.now },
    bannedAt: { type: Number },
    ignoredAt: { type: Number },
    screenshot: { type: String },
    riskLevel: { type: String },
    aiAnalysis: { type: mongoose.Schema.Types.Mixed }
}, { timestamps: true });

// Additional indexes (id already has unique index in schema)
ReportSchema.index({ hostname: 1 });
ReportSchema.index({ status: 1 });
ReportSchema.index({ userId: 1 });

const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String },
    name: { type: String },
    xp: { type: Number, default: 0 },
    level: { type: Number, default: 1 },
    safeStreak: { type: Number, default: 0 },
    lastCriticalTime: { type: Number },
    lastUpdated: { type: Number, default: Date.now },
    lastXpUpdate: { type: Number },
    pendingXPSync: { type: Boolean, default: false },
    _adminEdit: { type: Boolean, default: false },
    _adminEditTime: { type: Number },
    _adminEditXP: { type: Number },
    otp: { type: String },
    otpExpiry: { type: Number }
}, { timestamps: true });

// Email already has unique index in schema
// UserSchema.index({ email: 1 });

const AuditLogSchema = new mongoose.Schema({
    timestamp: { type: Number, required: true },
    action: { type: String, required: true },
    adminEmail: { type: String },
    target: { type: String },
    details: { type: mongoose.Schema.Types.Mixed }
}, { timestamps: true });

AuditLogSchema.index({ timestamp: -1 });
AuditLogSchema.index({ adminEmail: 1 });

const AdminSessionSchema = new mongoose.Schema({
    token: { type: String, required: true, unique: true },
    email: { type: String, required: true },
    expiresAt: { type: Date, required: true }
}, { timestamps: true });

// Token already has unique index in schema
AdminSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // Auto-delete expired sessions

const DeletedUserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    deletedAt: { type: Date, default: Date.now }
}, { timestamps: true });

// Email already has unique index in schema
// DeletedUserSchema.index({ email: 1 });

// Models
const TrustScore = mongoose.models.TrustScore || mongoose.model('TrustScore', TrustScoreSchema);
const Report = mongoose.models.Report || mongoose.model('Report', ReportSchema);
const User = mongoose.models.User || mongoose.model('User', UserSchema);
const AuditLog = mongoose.models.AuditLog || mongoose.model('AuditLog', AuditLogSchema);
const AdminSession = mongoose.models.AdminSession || mongoose.model('AdminSession', AdminSessionSchema);
const DeletedUser = mongoose.models.DeletedUser || mongoose.model('DeletedUser', DeletedUserSchema);

module.exports = {
    connectDB,
    isConnected: () => isConnected,
    TrustScore,
    Report,
    User,
    AuditLog,
    AdminSession,
    DeletedUser
};
