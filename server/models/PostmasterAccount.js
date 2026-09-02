const mongoose = require('mongoose');

// Metadata for each Postmaster domain discovered via domains.list (Phase 4).
const DiscoveredDomainSchema = new mongoose.Schema({
  domain: String,             // normalized, e.g. "example.com" (no "domains/" prefix)
  permission: String,         // PERMISSION_UNSPECIFIED | READER | ADMIN | OWNER | NONE
  verificationState: String,  // VERIFICATION_STATE_UNSPECIFIED | UNVERIFIED | VERIFIED
  createTime: String,
  lastVerifyTime: String,
}, { _id: false });

const PostmasterAccountSchema = new mongoose.Schema({
  googleEmail: { type: String, required: true },
  accessToken: { type: String, required: true },
  refreshToken: { type: String }, // Might be null if Google doesn't send it again
  tokenExpiry: { type: Date },
  // 'Connected' | 'Reauth Required' | 'Expired' | 'Error'
  status: { type: String, default: 'Connected' },
  lastError: { type: String },

  // Cache of the domains this account can access in Google Postmaster Tools.
  domains: [DiscoveredDomainSchema],

  lastSyncAt: Date,
}, { timestamps: true });

module.exports = mongoose.model('PostmasterAccount', PostmasterAccountSchema);
