import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db"; 
import * as schema from "./schema"; 

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification
    }
  }),
  // ADD THIS SECTION
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["google", "facebook", "linkedin"], 
    }
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      scope: ["email", "profile", "openid", "https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/business.manage"]
    },
    facebook: {
      clientId: process.env.FACEBOOK_CLIENT_ID!,
      clientSecret: process.env.FACEBOOK_CLIENT_SECRET!,
      scope: [
        "public_profile",
        "email",
        "pages_show_list", 
        "pages_read_engagement", 
        "pages_manage_posts", 
        "instagram_basic", 
        "instagram_content_publish"
      ]
    },
    linkedin: {
      clientId: process.env.LINKEDIN_CLIENT_ID!,
      clientSecret: process.env.LINKEDIN_CLIENT_SECRET!,
      scope: ["openid", "profile", "email", "w_member_social"]
    }
  },
});