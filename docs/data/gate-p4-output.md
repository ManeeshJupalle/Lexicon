# Lexicon session output

Generated 2026-09-22T02:45:30.687Z from 200 caption lines (2273 words), 0:09 to 19:44, model gpt-5.6-luna. Every point and definition below carries passages copied verbatim from the captions and checked by the server; nothing here comes from outside the transcript.

## Summary

- The lecture began with the eigenvalue equation Ax = lambda x: x is the eigenvector and lambda is the eigenvalue. The first task is to find the eigenvalues and eigenvectors. (4 lines from 0:09)
  “So the first lecture reached the key equation, Ax equals lambda x. x is the eigenvector and lambda” · “is the eigenvalue.” · “So job one is to find the eigenvalues and find the eigenvectors.”
- To diagonalize A, the eigenvectors are placed in the columns of an eigenvector matrix S. The lecture focused on the combination S inverse A S and the need to invert S. (6 lines from 0:42)
  “the good way to see that is diagonalize the matrix.” · “I put its eigenvectors in the columns of a matrix S. So S will be the eigenvector matrix.” · “Magic combination S inverse AS.” · “there's an S inverse.” · “invert.” · “this eigenvector matrix S. So for that, we need n independent eigenvectors.”
- With n linearly independent eigenvectors in the columns of S, multiplying A by S applies A to each column. Each resulting column is the corresponding eigenvalue multiplied by its eigenvector. (9 lines from 1:47)
  “We have n linearly independent eigenvectors.” · “In the columns.” · “Of this matrix S.” · “All I want to do is show you what happens when you multiply A times S.” · “I'll do it a column at a time.” · “A times the first column gives me the first column of the answer.” · “A times x1 is equal to the lambda times the x1.” · “Ax1 is the same as lambda 1 x1. Ax2 is lambda 2 x2, so on along to infinity.” · “In the nth column, we now have lambda n xn.”
- Separating the eigenvalues from the eigenvectors produces a diagonal eigenvalue matrix, called capital Lambda, with the eigenvalues on its diagonal. This gives the relation AS = S Lambda. (11 lines from 3:28)
  “I want to separate out those eigenvalues, those multiplying numbers.” · “That's going to multiply this matrix lambda 1 in the first entry and all zeros.” · “These are going to be my columns again. I'm getting S back again.” · “And give me lambda n xn. There, there you see matrix multiplication just working for us.” · “I wrote down what it meant, A times each eigenvector. That gave me lambda times the eigenvector.” · “S, my matrix back again, and this matrix, this diagonalized” · “matrix, the eigenvalue matrix.” · “And I call it capital lambda, using capital letters for matrices.” · “So you see that the eigenvalues are just sitting down that diagonal?” · “I would want the lambda 2 in the 2, 2 position, in the diagonal position, to multiply that x2 and give me the lambda 2 x2.” · “is S lambda.”
- Because linearly independent eigenvectors make S invertible, the relation can be rearranged into diagonalization: A = S Lambda S inverse. The lecturer presented this as a new factorization involving a matrix, a diagonal matrix, and the inverse of the first matrix. (12 lines from 6:27)
  “this business about n independent eigenvectors.” · “I want to be able to invert S.” · “is invertible.” · “AS equals S lambda.” · “And now I can multiply on the left by S inverse.” · “I can do that provided S is invertible, provided my assumption of n independent eigenvectors is satisfied.” · “we can diagonalize. This is diagonalization.” · “A multiplies S, and then this S inverse makes the whole thing diagonal.” · “A is S lambda S inverse.” · “That's the new factorization.” · “So it's a matrix times a diagonal matrix.” · “Times the inverse of the first one.”
- The lecture used this to explain matrix stability: powers of A go to zero when the absolute value of every eigenvalue is less than 1. The matrices S and S inverse remain fixed, so the behavior is determined by the diagonal eigenvalue matrix. (11 lines from 13:59)
  “I get A to the 100th is S lambda to the 100th S inverse.” · “Eigenvalues tell you about powers of a matrix in a way that we had no way to approach previously.” · “When do the powers of a matrix go to 0?” · “I would call that matrix stable, maybe.” · “It's present in the eigenvalues.” · “Well, S and S inverse are not moving.” · “So it's this guy that has to get small, and that's easy to understand. The requirement is all—” · “The eigenvalues have to be less than 1.” · “Absolute value.” · “Because those eigenvalues could be negative, they could be complex numbers, so I'm taking the absolute value if all of those are below 1.”

## Key terms, as used in this lecture

### eigenvector

An eigenvector is the vector x in the equation Ax = lambda x; it is reproduced by multiplication by A, up to a scalar factor.

Evidence (4 lines from 0:15): “x is the eigenvector and lambda is the eigenvalue.” · “That's an eigenvector.” · “A times x1 is equal to the lambda times the x1.”

### eigenvalue

An eigenvalue is the scalar lambda associated with an eigenvector in Ax = lambda x.

Evidence (3 lines from 0:15): “x is the eigenvector and lambda is the eigenvalue.” · “So job one is to find the eigenvalues and find the eigenvectors.”

### lambda

Lambda is the symbol used for an eigenvalue; in the matrix form, the eigenvalues are placed on the diagonal.

Evidence (4 lines from 3:00): “And that lambda we'll call lambda 1, of course.” · “So for the next step, I want to separate out those eigenvalues, those multiplying numbers.” · “And I call it capital lambda, using capital letters for matrices.” · “lambda to prompt me that it's eigenvalues that are in there. So you see that the eigenvalues are just sitting down that diagonal?”

### diagonalize

To diagonalize a matrix is to transform it into a form involving its eigenvector matrix and a diagonal matrix of eigenvalues.

Evidence (4 lines from 0:42): “the good way to see that is diagonalize the matrix.” · “The great— the most matrices that we see have n independent eigenvectors, and we can diagonalize.” · “A multiplies S, and then this S inverse makes the whole thing diagonal.” · “S is on the other side of the equation, A is S lambda S inverse.”

### eigenvector matrix

The eigenvector matrix S is formed by putting the eigenvectors of A in its columns.

Evidence (3 lines from 1:03): “This matrix A, I put its eigenvectors in the columns of a matrix S. So S will be the eigenvector matrix.” · “Of this matrix S.” · “I'm naturally going to call that the eigenvector matrix, because it's got the eigenvectors in its columns.”

### columns

The columns of S hold the successive eigenvectors, with the first eigenvector in the first column, the second in the second, and so on.

Evidence (Captions 2:29 to 2:41 · 2 lines): “the matrix with the first eigenvector in its first column, the second eigenvector in its second column.” · “The nth eigenvector in its nth column.”

### linearly independent

The required set consists of n linearly independent eigenvectors; this condition allows the eigenvector matrix S to be inverted.

Evidence (3 lines from 1:47): “We have n linearly independent eigenvectors.” · “I want to be able to invert S. And that's where this comes in. This n independent eigenvectors business comes in to tell me that that matrix” · “I can do that provided S is invertible, provided my assumption of n independent eigenvectors is satisfied.”

### matrix multiplication

For the product A times S, the lecturer performs the multiplication one column at a time.

Evidence (3 lines from 2:42): “And how am I going to do this matrix multiplication? Well, certainly I'll do it a column at a time.” · “A times the first column gives me the first column of the answer. But what is it?” · “There, there you see matrix multiplication just working for us.”

### invert

To invert S means to form S inverse, which can be used to isolate the diagonal eigenvalue matrix.

Evidence (4 lines from 1:15): “Magic combination S inverse AS.” · “And notice, notice, there's an S inverse.” · “So invert.” · “And now I can multiply on the left by S inverse.”

### diagonalized matrix

The diagonalized matrix is the matrix of eigenvalues, with the eigenvalues placed along its diagonal.

Evidence (4 lines from 5:29): “this matrix, this diagonalized” · “matrix, the eigenvalue matrix.” · “So you see that the eigenvalues are just sitting down that diagonal?” · “I would want the lambda 2 in the 2, 2 position, in the diagonal position, to multiply that x2 and give me the lambda 2 x2.”

### eigenvalue matrix

The eigenvalue matrix is the diagonal matrix, denoted by capital Lambda, whose diagonal entries are the eigenvalues.

Evidence (Captions 5:29 to 6:00 · 4 lines): “this matrix, this diagonalized” · “matrix, the eigenvalue matrix.” · “And I call it capital lambda, using capital letters for matrices.” · “lambda to prompt me that it's eigenvalues that are in there. So you see that the eigenvalues are just sitting down that diagonal?”

### invertible

A matrix is invertible here when its inverse exists; S is invertible when the assumption of n independent eigenvectors is satisfied.

Evidence (3 lines from 6:45): “I want to be able to invert S. And that's where this comes in. This n independent eigenvectors business comes in to tell me that that matrix” · “is invertible. So let me, on the next board, write down what I've got. AS equals S lambda.” · “I can do that provided S is invertible, provided my assumption of n independent eigenvectors is satisfied.”

### diagonalization

Diagonalization is the process of obtaining a diagonal matrix from A using S and S inverse; it is possible when S inverse exists.

Evidence (4 lines from 7:44): “we can diagonalize. This is diagonalization.” · “S is on the other side of the equation, A is S lambda S inverse.” · “So that's the new factorization.” · “Diagonalization is only possible if S inverse makes sense.”

### stable

A matrix is called stable, possibly, when its powers go to zero as the power gets larger.

Evidence (3 lines from 14:21): “When do the powers of a matrix go to 0?” · “I would call that matrix stable, maybe.” · “k approaches 0 as k goes— as k gets bigger.”

### distinct eigenvalues

Distinct eigenvalues are eigenvalues with no repetitions; when all eigenvalues are different, the eigenvectors are automatically independent.

Evidence (7 lines from 18:11): “Lambda's are different.” · “That means no repeated” · “eigenvalues.” · “They would be distinct is the best word. I would have— a random matrix will have 10 distinct— a 10 by 10 matrix will have 10 distinct eigenvalues.” · “The eigenvectors are automatically independent.” · “If the eigenvalues are different.” · “If all eigenvalues are different.”

## Glossary terms: missed or mangled

Every supplied term was found in the captions.

11 of 11 supplied terms found: eigenvector (39), eigenvalue (33), lambda (42), diagonalize (4), linearly independent (1), eigenvector matrix (3), invert (2), columns (23), diagonalization (2), invertible (2), matrix multiplication (2).

A “possibly” span is a caption span that resembles the term by spelling or that the model proposed; whether it really was the term cannot be settled without the audio.

## Not shown

- 2 summary point(s) dropped for failing verification against the captions.

