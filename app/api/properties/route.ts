import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth'; // Your Better-Auth server instance
import { headers } from 'next/headers';
import { db } from '@/lib/db';
import { properties } from '@/lib/schema';
import { eq, desc } from 'drizzle-orm';

export async function GET(request: Request) {
  // 1. Check if user is logged in
  const session = await auth.api.getSession({
    headers: await headers()
  });

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 2. Fetch properties for this user from Drizzle/Postgres
    const data = await db
      .select()
      .from(properties)
      .where(eq(properties.userId, session.user.id))
      .orderBy(desc(properties.createdAt));

    return NextResponse.json(data);
  } catch (error) {
    console.error("DB Error:", error);
    return NextResponse.json({ error: "Failed to fetch properties" }, { status: 500 });
  }
}

export async function POST(request: Request) {
    // 1. Auth Check
    const session = await auth.api.getSession({
        headers: await headers()
    });
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();

    try {
        // 2. Insert into Drizzle
        const [newProp] = await db.insert(properties).values({
            userId: session.user.id,
            title: body.title,
            address: body.address,
            price: body.price,
            description: body.description,
            propertyType: body.property_type,
            status: 'Active',
            imageUrl: body.image_url,
            images: body.images
        }).returning();

        return NextResponse.json(newProp);
    } catch (error) {
        return NextResponse.json({ error: "Failed to create" }, { status: 500 });
    }
}