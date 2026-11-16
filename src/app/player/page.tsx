import React, { Suspense } from 'react'
import ClientPlayer from './clientPlayer';
 
async function PlayerPage () {  
  return (
    <Suspense fallback={<>...</>}>
      <ClientPlayer />
    </Suspense>
  )
}

export default PlayerPage;