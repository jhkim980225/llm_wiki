import { redirect } from 'next/navigation'

/** /wiki 맨몸은 catch-all에 안 걸려 404였다. 들머리로 보낸다. */
export default function WikiIndex() {
  redirect('/')
}
