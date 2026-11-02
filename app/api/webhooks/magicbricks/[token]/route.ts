import { handleMagicbricksGet, handleMagicbricksPost } from '../magicbricks-handler'

export async function GET(
    request: Request,
    { params }: { params: Promise<{ token: string }> }
) {
    const { token } = await params
    return handleMagicbricksGet(request, token)
}

export async function POST(
    request: Request,
    { params }: { params: Promise<{ token: string }> }
) {
    const { token } = await params
    return handleMagicbricksPost(request, token)
}
