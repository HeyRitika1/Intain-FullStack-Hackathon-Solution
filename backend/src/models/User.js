import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, required: true },
    name: { type: String, trim: true },
    role: {
      type: String,
      enum: ["operator", "reviewer", "consumer", "admin"],
      required: true,
    },
  },
  { timestamps: true }
);

userSchema.methods.verifyPassword = function verifyPassword(plain) {
  if (!plain || !this.passwordHash) return Promise.resolve(false);
  return bcrypt.compare(String(plain), this.passwordHash);
};

userSchema.statics.hashPassword = function hashPassword(plain) {
  return bcrypt.hash(String(plain), 10);
};

userSchema.set("toJSON", {
  transform: (_doc, ret) => {
    delete ret.passwordHash;
    return ret;
  },
});

export const User = mongoose.models.User || mongoose.model("User", userSchema);
export default User;
