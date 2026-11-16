import React, { Suspense } from 'react'
import ClientSearch from './clientSearch'
 
async function SearchPage () {  
  return (
    <Suspense fallback={<>...</>}>
      <ClientSearch />
    </Suspense>
  )
}

export default SearchPage;