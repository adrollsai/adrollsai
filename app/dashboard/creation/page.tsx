import { redirect } from 'next/navigation'

/**
 * Creation has been folded into the Nobogent agent surface.
 *
 * The standalone AI Creator tab was removed from the navigation: creatives are
 * now produced in `/dashboard/agent`, which owns the same generation tools plus
 * the conversation context. This route is kept only so existing bookmarks,
 * shared links and the "Generate creatives" action in the Catalog tab keep
 * working instead of 404ing.
 *
 * The previous implementation is still in git history if it is ever needed back.
 */
export default function CreationMovedPage() {
  redirect('/dashboard/agent')
}
