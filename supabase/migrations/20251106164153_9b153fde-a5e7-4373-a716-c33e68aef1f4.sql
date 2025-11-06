-- Fix the INSERT policy to explicitly check for authenticated users
DROP POLICY IF EXISTS "Users can create organizations" ON public.organizations;

CREATE POLICY "Users can create organizations" 
ON public.organizations 
FOR INSERT 
WITH CHECK (auth.uid() IS NOT NULL);