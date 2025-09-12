import { NextRequest, NextResponse } from 'next/server';

// GET /api/download - API入口点
export async function GET(_request: NextRequest) {
  return NextResponse.json({ success: true, message: 'API download 接口' });
}

// POST /api/download - API入口点
export async function POST(_request: NextRequest) {
  return NextResponse.json({ success: true, message: 'API download 接口' });
}

// PUT /api/download - API入口点
export async function PUT(_request: NextRequest) {
  return NextResponse.json({ success: true, message: 'API download 接口' });
}

// DELETE /api/download - API入口点
export async function DELETE(_request: NextRequest) {
  return NextResponse.json({ success: true, message: 'API download 接口' });
}
