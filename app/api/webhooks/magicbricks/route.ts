import { handleMagicbricksGet, handleMagicbricksPost } from './magicbricks-handler'

export async function GET(request: Request) {
    return handleMagicbricksGet(request)
}

export async function POST(request: Request) {
    return handleMagicbricksPost(request)
}
