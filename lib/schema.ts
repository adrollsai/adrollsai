import { pgTable, text, timestamp, boolean, uuid, jsonb } from 'drizzle-orm/pg-core';

// --- AUTH TABLES (Updated with required fields) ---

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  
  // Custom Fields
  businessName: text('business_name'),
  missionStatement: text('mission_statement'),
  brandColor: text('brand_color').default('#D0E8FF'),
  contactNumber: text('contact_number'),
  logoUrl: text('logo_url'),
  
  // Tokens
  facebookToken: text('facebook_token'),
  linkedinToken: text('linkedin_token'),
  googleBusinessToken: text('google_business_token'),
  youtubeToken: text('youtube_token'),
  
  // Page Metadata
  selectedPageId: text('selected_page_id'),
  selectedPageToken: text('selected_page_token'),
  selectedPageName: text('selected_page_name'),
  
  // WhatsApp
  whatsappBusinessId: text('whatsapp_business_id'),
  whatsappPhoneId: text('whatsapp_phone_id'),
  whatsappAccessToken: text('whatsapp_access_token'),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(), // Added required field
  createdAt: timestamp("created_at").notNull(), // Added required field
  updatedAt: timestamp("updated_at").notNull(), // Added required field
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(()=> user.id)
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(()=> user.id),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull(), // Added required field
  updatedAt: timestamp("updated_at").notNull()  // Added required field
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at"), // Added required field (caused your error)
  updatedAt: timestamp("updated_at")  // Added required field
});

// --- YOUR APP DATA (Unchanged) ---

export const properties = pgTable('properties', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: text('user_id').references(() => user.id).notNull(),
  title: text('title').notNull(),
  address: text('address').notNull(),
  price: text('price').notNull(),
  description: text('description'),
  propertyType: text('property_type').default('Residential'),
  status: text('status').default('Active'),
  imageUrl: text('image_url').notNull(),
  images: jsonb('images').$type<string[]>(), 
  createdAt: timestamp('created_at').defaultNow()
});

export const assets = pgTable('assets', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: text('user_id').references(() => user.id).notNull(),
  url: text('url').notNull(),
  type: text('type').notNull(), 
  status: text('status').default('Draft'),
  createdAt: timestamp('created_at').defaultNow()
});

export const dailyDrafts = pgTable('daily_drafts', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: text('user_id').references(() => user.id).notNull(),
  imageUrl: text('image_url').notNull(),
  caption: text('caption'),
  status: text('status').default('pending'),
  createdAt: timestamp('created_at').defaultNow()
});